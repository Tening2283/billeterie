import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { holdResponseSchema, tripSeatsResponseSchema } from '@billetterie/shared';
import { holdKey } from '../src/services/hold-store';
import { createTrip, resetDb, sellSeats } from './db';
import { rawRedis, REDIS_PREFIX, resetRedis, testRedis } from './redis';
import { authAs, buildTestApp, recordingEvents } from './helpers';

const app = buildTestApp();

beforeEach(async () => {
  await Promise.all([resetDb(), resetRedis()]);
});

const hold = (tripId: string, seatNumber: unknown, header?: string, on: Express = app) => {
  const req = request(on).post(`/api/v1/trips/${tripId}/holds`).send({ seatNumber });
  return header ? req.set('Authorization', header) : req;
};
const release = (tripId: string, seat: number | string, header: string, on: Express = app) =>
  request(on).delete(`/api/v1/trips/${tripId}/holds/${seat}`).set('Authorization', header);
const seatsOf = async (tripId: string, header?: string) => {
  const req = request(app).get(`/api/v1/trips/${tripId}/seats`);
  const res = await (header ? req.set('Authorization', header) : req).expect(200);
  return tripSeatsResponseSchema.parse(res.body).seats;
};

describe('POST /api/v1/trips/:id/holds', () => {
  it('201 : bloque la place 10 minutes', async () => {
    const trip = await createTrip();
    const { header } = await authAs();

    const res = await hold(trip.id, 3, header).expect(201);

    const body = holdResponseSchema.parse(res.body);
    expect(body).toMatchObject({ tripId: trip.id, seatNumber: 3 });
    const inMs = Date.parse(body.expiresAt) - Date.now();
    expect(inMs).toBeGreaterThan(590_000);
    expect(inMs).toBeLessThanOrEqual(600_000);
  });

  it('pose `hold:{trajet}:{place}` = userId avec expiration, sous le préfixe de l’environnement', async () => {
    const trip = await createTrip();
    const { user, header } = await authAs();

    await hold(trip.id, 3, header).expect(201);

    expect(await testRedis.get(holdKey(trip.id, 3))).toBe(user.id);
    expect(await rawRedis.get(`${REDIS_PREFIX}hold:${trip.id}:3`)).toBe(user.id);
    expect(await testRedis.pttl(holdKey(trip.id, 3))).toBeGreaterThan(590_000);
  });

  it('les autres voient la place bloquée, son auteur la voit « bloquée par moi »', async () => {
    const trip = await createTrip();
    const me = await authAs();
    const other = await authAs();
    const { body } = await hold(trip.id, 3, me.header).expect(201);

    const mine = (await seatsOf(trip.id, me.header))[2];
    const theirs = (await seatsOf(trip.id, other.header))[2];
    const anonymous = (await seatsOf(trip.id))[2];

    expect(mine).toEqual({
      seatNumber: 3,
      state: 'held',
      heldByMe: true,
      expiresAt: body.expiresAt,
    });
    expect(theirs).toEqual({ ...mine, heldByMe: false });
    expect(anonymous).toEqual({ ...mine, heldByMe: false });
  });

  it('rebloquer sa propre place est sans effet : 201, même échéance', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    const first = await hold(trip.id, 3, header).expect(201);

    const again = await hold(trip.id, 3, header).expect(201);

    const drift = Math.abs(Date.parse(again.body.expiresAt) - Date.parse(first.body.expiresAt));
    expect(drift).toBeLessThan(2000);
  });

  it('409 SEAT_TAKEN si un autre voyageur l’a déjà bloquée', async () => {
    const trip = await createTrip();
    await hold(trip.id, 3, (await authAs()).header).expect(201);

    const res = await hold(trip.id, 3, (await authAs()).header).expect(409);

    expect(res.body.error.code).toBe('SEAT_TAKEN');
  });

  it('409 SEAT_TAKEN si la place est déjà vendue', async () => {
    const trip = await createTrip();
    await sellSeats(trip.id, [3]);

    const res = await hold(trip.id, 3, (await authAs()).header).expect(409);

    expect(res.body.error.code).toBe('SEAT_TAKEN');
  });

  it('409 HOLD_LIMIT à la 5e place du même trajet (les autres trajets restent possibles)', async () => {
    const trip = await createTrip();
    const otherTrip = await createTrip({ departureAt: new Date(Date.now() + 2 * 86_400_000) });
    const { header } = await authAs();
    for (const seat of [1, 2, 3, 4]) await hold(trip.id, seat, header).expect(201);

    const res = await hold(trip.id, 5, header).expect(409);

    expect(res.body.error).toMatchObject({ code: 'HOLD_LIMIT', details: { max: 4 } });
    await hold(otherTrip.id, 5, header).expect(201);
  });

  it('400 pour une place hors du car ou un corps invalide', async () => {
    const trip = await createTrip({ seatCount: 15 });
    const { header } = await authAs();

    const outside = await hold(trip.id, 16, header).expect(400);
    expect(outside.body.error.details).toEqual({ seatNumbers: [16], seatCount: 15 });
    await hold(trip.id, 'trois', header).expect(400);
  });

  it('404 pour un trajet inconnu ou un identifiant mal formé', async () => {
    const { header } = await authAs();

    await hold('00000000-0000-4000-8000-000000000000', 1, header).expect(404);
    await hold('pas-un-uuid', 1, header).expect(404);
  });

  it('409 TRIP_CLOSED pour un trajet annulé ou déjà parti', async () => {
    const cancelled = await createTrip({ status: 'cancelled' });
    const departed = await createTrip({ departureAt: new Date(Date.now() - 60_000) });
    const { header } = await authAs();

    for (const trip of [cancelled, departed]) {
      const res = await hold(trip.id, 1, header).expect(409);
      expect(res.body.error.code).toBe('TRIP_CLOSED');
    }
  });

  it('401 sans jeton, 403 pour un contrôleur', async () => {
    const trip = await createTrip();

    await hold(trip.id, 1).expect(401);
    const res = await hold(trip.id, 1, (await authAs('controller')).header).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('limite 30 requêtes par minute et par utilisateur (pas par IP)', async () => {
    const limited = buildTestApp({ rateLimits: { holds: 2 } });
    const trip = await createTrip();
    const a = await authAs();
    const b = await authAs();

    await hold(trip.id, 1, a.header, limited).expect(201);
    await hold(trip.id, 2, a.header, limited).expect(201);
    const res = await hold(trip.id, 3, a.header, limited).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    await hold(trip.id, 3, b.header, limited).expect(201); // même IP, autre utilisateur
  });
});

describe('DELETE /api/v1/trips/:id/holds/:seatNumber', () => {
  it('204 : la place redevient libre', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    await hold(trip.id, 3, header).expect(201);

    await release(trip.id, 3, header).expect(204);

    expect((await seatsOf(trip.id))[2]?.state).toBe('free');
    expect(await testRedis.exists(holdKey(trip.id, 3))).toBe(0);
  });

  it('404 si la place est bloquée par quelqu’un d’autre, qui la garde', async () => {
    const trip = await createTrip();
    const owner = await authAs();
    await hold(trip.id, 3, owner.header).expect(201);

    const res = await release(trip.id, 3, (await authAs()).header).expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect((await seatsOf(trip.id, owner.header))[2]?.heldByMe).toBe(true);
  });

  it('404 si rien n’est bloqué, ou pour un numéro / un trajet invalide', async () => {
    const trip = await createTrip();
    const { header } = await authAs();

    await release(trip.id, 3, header).expect(404);
    await release(trip.id, 'abc', header).expect(404);
    await release('pas-un-uuid', 3, header).expect(404);
  });

  it('401 sans jeton', async () => {
    const trip = await createTrip();
    await request(app).delete(`/api/v1/trips/${trip.id}/holds/3`).expect(401);
  });
});

describe('GET /api/v1/trips/:id/seats avec blocages', () => {
  it('vendue l’emporte sur bloquée ; les autres places restent libres', async () => {
    const trip = await createTrip({ seatCount: 15 });
    const { header } = await authAs();
    await hold(trip.id, 1, header).expect(201);
    await sellSeats(trip.id, [2]);

    const seats = await seatsOf(trip.id, header);

    expect(seats.map((s) => s.state).slice(0, 3)).toEqual(['held', 'sold', 'free']);
  });

  it('401 si un jeton est fourni mais invalide (pas de repli silencieux en anonyme)', async () => {
    const trip = await createTrip();

    const res = await request(app)
      .get(`/api/v1/trips/${trip.id}/seats`)
      .set('Authorization', 'Bearer expiré')
      .expect(401);

    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('événements', () => {
  it('seat:held puis seat:released, sans identité d’utilisateur', async () => {
    const events = recordingEvents();
    const withEvents = buildTestApp({ events });
    const trip = await createTrip();
    const { user, header } = await authAs();

    const { body } = await hold(trip.id, 3, header, withEvents).expect(201);
    await hold(trip.id, 3, header, withEvents).expect(201); // re-blocage : pas de nouvel événement
    await release(trip.id, 3, header, withEvents).expect(204);

    expect(events.log).toEqual([
      { type: 'held', tripId: trip.id, seatNumber: 3, expiresAt: body.expiresAt },
      { type: 'released', tripId: trip.id, seatNumber: 3 },
    ]);
    expect(JSON.stringify(events.log)).not.toContain(user.id);
  });
});
