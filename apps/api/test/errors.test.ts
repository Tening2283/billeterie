import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { isApiError } from '@billetterie/shared';
import { AppError } from '../src/lib/app-error';
import { errorHandler } from '../src/middleware/errors';
import { buildTestApp, silentLogger } from './helpers';

/** Mini-appli qui lève chaque type d'erreur, pour tester le gestionnaire isolément. */
function appThatThrows(error: unknown) {
  const app = express();
  app.use(pinoHttp({ logger: silentLogger }));
  app.get('/boom', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('format des erreurs', () => {
  it('route inconnue : 404 NOT_FOUND', async () => {
    const res = await request(buildTestApp()).get('/api/v1/nope').expect(404);

    expect(isApiError(res.body)).toBe(true);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('JSON illisible : 400 VALIDATION_ERROR', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{pas du json')
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AppError : statut, code, message et détails conservés', async () => {
    const res = await request(
      appThatThrows(
        new AppError(409, 'SEAT_TAKEN', 'Cette place vient d’être prise.', { seat: 12 }),
      ),
    )
      .get('/boom')
      .expect(409);

    expect(res.body).toEqual({
      error: {
        code: 'SEAT_TAKEN',
        message: 'Cette place vient d’être prise.',
        details: { seat: 12 },
      },
    });
  });

  it('ZodError : 400 avec la liste des problèmes', async () => {
    const zodError = z.object({ seatNumber: z.number() }).safeParse({ seatNumber: 'x' }).error;
    const res = await request(appThatThrows(zodError)).get('/boom').expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.issues[0].path).toEqual(['seatNumber']);
  });

  it('erreur inattendue : 500 sans fuite du message interne', async () => {
    const res = await request(appThatThrows(new Error('mot de passe db: hunter2')))
      .get('/boom')
      .expect(500);

    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
