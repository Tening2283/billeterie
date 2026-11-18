import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authResponseSchema, publicUserSchema } from '@billetterie/shared';
import { createTokenService } from '../src/lib/tokens';
import { resetDb, testDb } from './db';
import { authAs, buildTestApp, testTokens } from './helpers';

const app = buildTestApp();
const account = { email: 'awa.diop@mail.sn', password: 'motdepasse-solide', name: 'Awa Diop' };

beforeEach(resetDb);

const register = (body: object = account) => request(app).post('/api/v1/auth/register').send(body);
const login = (body: object) => request(app).post('/api/v1/auth/login').send(body);
const me = (authorization?: string) => {
  const req = request(app).get('/api/v1/auth/me');
  return authorization ? req.set('Authorization', authorization) : req;
};

describe('POST /api/v1/auth/register', () => {
  it('201 : crée un voyageur et renvoie un jeton utilisable', async () => {
    const res = await register().expect(201);

    const body = authResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({ email: account.email, name: account.name, role: 'traveler' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    await me(`Bearer ${body.token}`).expect(200);

    const expiresInMs = new Date(body.expiresAt).getTime() - Date.now();
    expect(expiresInMs).toBeGreaterThan(59 * 60_000);
    expect(expiresInMs).toBeLessThanOrEqual(60 * 60_000);
  });

  it('stocke un hachage bcrypt, jamais le mot de passe', async () => {
    await register().expect(201);

    const user = await testDb.user.findUniqueOrThrow({ where: { email: account.email } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$04\$/);
    expect(user.passwordHash).not.toContain(account.password);
  });

  it('409 EMAIL_TAKEN si l’e-mail existe déjà (casse ignorée)', async () => {
    await register().expect(201);

    const res = await register({ ...account, email: ' AWA.DIOP@mail.sn ' }).expect(409);

    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('409 pour une seule des deux inscriptions simultanées du même e-mail', async () => {
    const results = await Promise.all([register(), register()]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('400 : corps invalide ou champ inconnu (impossible de s’inscrire admin)', async () => {
    const bad = await register({ ...account, password: 'court' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    await register({ ...account, role: 'admin' }).expect(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await register().expect(201);
  });

  it('200 avec le bon mot de passe', async () => {
    const res = await login({ email: 'Awa.Diop@mail.sn', password: account.password }).expect(200);

    expect(authResponseSchema.parse(res.body).user.email).toBe(account.email);
  });

  it('401 INVALID_CREDENTIALS, même message pour un mauvais mot de passe et un e-mail inconnu', async () => {
    const wrongPassword = await login({ email: account.email, password: 'mauvais' }).expect(401);
    const unknownEmail = await login({ email: 'inconnu@mail.sn', password: 'x' }).expect(401);

    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('400 si le corps est incomplet', async () => {
    await login({ email: account.email }).expect(400);
  });
});

describe('comptes de démo protégés', () => {
  it('400 : personne ne peut s’inscrire avec une adresse @demo.test', async () => {
    for (const email of ['voyageur@demo.test', 'Controleur@DEMO.test', 'autre@demo.test']) {
      const res = await register({ ...account, email }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('un compte de démo au mauvais rôle est réparé (rôle et mot de passe remplacés)', async () => {
    // Situation héritée : compte créé avec le mauvais rôle et un mot de passe connu de quelqu'un.
    const squatted = await testDb.user.create({
      data: {
        email: 'controleur@demo.test',
        name: 'Squatteur',
        passwordHash: 'hash-connu',
        role: 'traveler',
      },
    });

    const res = await request(app)
      .post('/api/v1/auth/demo')
      .send({ role: 'controller' })
      .expect(200);

    expect(res.body.user).toMatchObject({ id: squatted.id, role: 'controller' });
    const repaired = await testDb.user.findUniqueOrThrow({ where: { id: squatted.id } });
    expect(repaired.passwordHash).not.toBe('hash-connu');
  });
});

describe('POST /api/v1/auth/demo', () => {
  it.each(['traveler', 'controller'] as const)('200 : jeton du compte de démo %s', async (role) => {
    const res = await request(app).post('/api/v1/auth/demo').send({ role }).expect(200);

    const body = authResponseSchema.parse(res.body);
    expect(body.user.role).toBe(role);
    expect(body.user.email).toMatch(/@demo\.test$/);
  });

  it('réutilise le même compte d’une fois sur l’autre', async () => {
    const a = await request(app).post('/api/v1/auth/demo').send({ role: 'traveler' });
    const b = await request(app).post('/api/v1/auth/demo').send({ role: 'traveler' });

    expect(a.body.user.id).toBe(b.body.user.id);
  });

  it('400 pour le rôle admin', async () => {
    await request(app).post('/api/v1/auth/demo').send({ role: 'admin' }).expect(400);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('200 : l’utilisateur du jeton', async () => {
    const { user, header } = await authAs('controller');

    const res = await me(header).expect(200);

    expect(publicUserSchema.parse(res.body)).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'controller',
    });
  });

  it.each([
    ['sans en-tête', undefined],
    ['schéma autre que Bearer', 'Basic abc'],
    ['jeton illisible', 'Bearer pas.un.jwt'],
  ])('401 UNAUTHENTICATED : %s', async (_label, header) => {
    const res = await me(header).expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 pour un jeton signé avec un autre secret', async () => {
    const { user } = await authAs();
    const forged = await createTokenService('un-autre-secret-de-plus-de-32-caracteres!').sign({
      id: user.id,
      role: 'admin',
    });

    await me(`Bearer ${forged.token}`).expect(401);
  });

  it('401 pour un jeton expiré', async () => {
    const { user } = await authAs();
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const expired = await createTokenService(process.env.JWT_SECRET!, {
      now: () => twoHoursAgo,
    }).sign({ id: user.id, role: 'traveler' });

    await me(`Bearer ${expired.token}`).expect(401);
  });

  it('401 si le compte du jeton a été supprimé', async () => {
    const { token } = await testTokens.sign({
      id: '00000000-0000-4000-8000-000000000000',
      role: 'traveler',
    });

    const res = await me(`Bearer ${token}`).expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('limitation de débit', () => {
  it('connexion : 5 essais par minute et par IP, puis 429 RATE_LIMITED', async () => {
    const limited = buildTestApp({ rateLimits: { login: 5 } });
    const attempt = () =>
      request(limited).post('/api/v1/auth/login').send({ email: 'x@y.sn', password: 'x' });

    for (let i = 0; i < 5; i++) await attempt().expect(401);
    const res = await attempt().expect(429);

    expect(res.body.error.code).toBe('RATE_LIMITED');
    // Temps réellement restant dans la fenêtre d'une minute (déjà entamée par les 5 essais).
    const { retryAfterSeconds } = res.body.error.details;
    expect(retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(res.body.error.message).toContain(`${retryAfterSeconds} s`);
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('le front (autre domaine) peut lire les en-têtes utiles, exposés par CORS', async () => {
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    const exposed = String(res.headers['access-control-expose-headers']);
    for (const header of ['Idempotent-Replayed', 'X-Request-Id', 'RateLimit', 'Retry-After']) {
      expect(exposed).toContain(header);
    }
  });

  it('chaque IP a son propre compteur (derrière le proxy de Render)', async () => {
    const limited = buildTestApp({ rateLimits: { demo: 1 } });
    const demo = (ip: string) =>
      request(limited)
        .post('/api/v1/auth/demo')
        .set('X-Forwarded-For', ip)
        .send({ role: 'traveler' });

    await demo('41.82.0.1').expect(200);
    await demo('41.82.0.1').expect(429);
    await demo('41.82.0.2').expect(200);
  });
});
