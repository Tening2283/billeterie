import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { healthResponseSchema } from '@billetterie/shared';
import { buildTestApp } from './helpers';

describe('GET /api/v1/health', () => {
  it('vérifie par défaut les vrais PostgreSQL et Redis', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', checks: { postgres: 'up', redis: 'up' } });
  });

  it('répond 200 quand toutes les dépendances répondent', async () => {
    const app = buildTestApp({
      healthChecks: { postgres: async () => 1, redis: async () => 'PONG' },
    });

    const res = await request(app).get('/api/v1/health').expect(200);

    expect(healthResponseSchema.parse(res.body)).toEqual({
      status: 'ok',
      checks: { postgres: 'up', redis: 'up' },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('répond 503 si une dépendance échoue', async () => {
    const app = buildTestApp({
      healthChecks: {
        postgres: async () => 1,
        redis: async () => {
          throw new Error('connexion refusée');
        },
      },
    });

    const res = await request(app).get('/api/v1/health').expect(503);

    expect(res.body).toEqual({ status: 'degraded', checks: { postgres: 'up', redis: 'down' } });
  });

  it('répond 503 si une dépendance met trop de temps', async () => {
    const app = buildTestApp({
      healthTimeoutMs: 20,
      healthChecks: { postgres: () => new Promise((resolve) => setTimeout(resolve, 500)) },
    });

    const res = await request(app).get('/api/v1/health').expect(503);

    expect(res.body.checks).toEqual({ postgres: 'down' });
  });

  it('reprend l’identifiant de requête fourni par le client', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health')
      .set('x-request-id', 'abc-123')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('autorise le front déclaré en CORS', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
