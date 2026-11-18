import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { holdKey } from '../src/services/hold-store';
import { createTrip, resetDb } from './db';
import { resetRedis, testRedis } from './redis';
import { authAs, buildTestApp } from './helpers';

const app = buildTestApp();
const N = 30;

beforeEach(async () => {
  await Promise.all([resetDb(), resetRedis()]);
});

/** Test de concurrence n° 1 du cahier des charges. */
describe('même place, N voyageurs en même temps', () => {
  it(`exactement une réponse 201 et ${N - 1} réponses 409 SEAT_TAKEN`, async () => {
    const trip = await createTrip({ seatCount: 50 });
    const travelers = await Promise.all(Array.from({ length: N }, () => authAs()));

    const responses = await Promise.all(
      travelers.map(({ header }) =>
        request(app)
          .post(`/api/v1/trips/${trip.id}/holds`)
          .set('Authorization', header)
          .send({ seatNumber: 7 }),
      ),
    );

    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(N - 1);
    expect(losers.every((r) => r.body.error.code === 'SEAT_TAKEN')).toBe(true);

    // Le propriétaire dans Redis est bien celui qui a reçu le 201.
    const winner = travelers[responses.indexOf(winners[0]!)]!;
    expect(await testRedis.get(holdKey(trip.id, 7))).toBe(winner.user.id);
  });
});

describe('limite de 4 places sous concurrence', () => {
  it('10 blocages simultanés du même voyageur sur 10 places : exactement 4 réussissent', async () => {
    const trip = await createTrip({ seatCount: 50 });
    const { header } = await authAs();

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post(`/api/v1/trips/${trip.id}/holds`)
          .set('Authorization', header)
          .send({ seatNumber: i + 1 }),
      ),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(4);
    expect(responses.filter((r) => r.body.error?.code === 'HOLD_LIMIT')).toHaveLength(6);
  });
});
