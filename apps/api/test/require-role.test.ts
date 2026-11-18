import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pinoHttp } from 'pino-http';
import { createAuthMiddleware, currentUser } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errors';
import { silentLogger, testTokens } from './helpers';

/** Mini-appli avec une route réservée aux contrôleurs (les vraies routes protégées arrivent aux étapes 3 et 4). */
function appWithProtectedRoute() {
  const { requireRole } = createAuthMiddleware(testTokens);
  const app = express();
  app.use(pinoHttp({ logger: silentLogger }));
  app.post('/verify', requireRole('controller', 'admin'), (req, res) => {
    res.json({ by: currentUser(req) });
  });
  app.use(errorHandler);
  return app;
}

const tokenFor = async (role: 'traveler' | 'controller' | 'admin') =>
  `Bearer ${(await testTokens.sign({ id: '11111111-1111-4111-8111-111111111111', role })).token}`;

describe('requireRole', () => {
  const app = appWithProtectedRoute();

  it('401 sans jeton', async () => {
    const res = await request(app).post('/verify').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('403 FORBIDDEN pour un rôle non autorisé', async () => {
    const res = await request(app)
      .post('/verify')
      .set('Authorization', await tokenFor('traveler'))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(['controller', 'admin'] as const)('200 pour le rôle %s', async (role) => {
    const res = await request(app)
      .post('/verify')
      .set('Authorization', await tokenFor(role))
      .expect(200);
    expect(res.body.by.role).toBe(role);
  });
});

describe('currentUser', () => {
  it('lève 401 si appelé sans authentification préalable', () => {
    expect(() => currentUser({} as express.Request)).toThrow(/Connectez-vous/);
  });
});
