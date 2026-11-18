import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { bookingSchema, myBookingsResponseSchema } from '@billetterie/shared';
import { EXPIRY_KEY, holdKey, holdMember } from '../src/services/hold-store';
import { createTrip, resetDb, sellSeats, testDb } from './db';
import { resetRedis, testRedis } from './redis';
import { authAs, buildTestApp, recordingEvents } from './helpers';

const events = recordingEvents();
const app = buildTestApp({ events });

beforeEach(async () => {
  await Promise.all([resetDb(), resetRedis()]);
  events.log.length = 0;
});

const passengers = (seats: number[]) =>
  seats.map((seatNumber) => ({ seatNumber, passengerName: `Passager ${seatNumber}` }));

async function holdSeats(tripId: string, header: string, seats: number[], on: Express = app) {
  for (const seatNumber of seats) {
    await request(on)
      .post(`/api/v1/trips/${tripId}/holds`)
      .set('Authorization', header)
      .send({ seatNumber })
      .expect(201);
  }
}

function book(body: object, header: string, key: string | null = randomUUID(), on = app) {
  const req = request(on).post('/api/v1/bookings').set('Authorization', header);
  return (key === null ? req : req.set('Idempotency-Key', key)).send(body);
}

describe('POST /api/v1/bookings', () => {
  it('201 : crée la réservation et un billet par place, au prix du trajet', async () => {
    const trip = await createTrip({ priceFcfa: 2500 });
    const { user, header } = await authAs();
    await holdSeats(trip.id, header, [3, 2]);

    const res = await book({ tripId: trip.id, passengers: passengers([3, 2]) }, header).expect(201);

    const booking = bookingSchema.parse(res.body);
    expect(booking).toMatchObject({
      status: 'confirmed',
      totalFcfa: 5000,
      trip: { id: trip.id, origin: 'Dakar', destination: 'Thiès' },
    });
    expect(booking.tickets.map((t) => [t.seatNumber, t.passengerName, t.status])).toEqual([
      [2, 'Passager 2', 'valid'],
      [3, 'Passager 3', 'valid'],
    ]);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await testDb.booking.count({ where: { userId: user.id } })).toBe(1);
  });

  it('après la vente : places vendues, blocages supprimés, seat:sold émis (pas seat:released)', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    await holdSeats(trip.id, header, [2, 3]);

    await book({ tripId: trip.id, passengers: passengers([2, 3]) }, header).expect(201);

    const seats = await request(app).get(`/api/v1/trips/${trip.id}/seats`).expect(200);
    expect(seats.body.seats.slice(1, 3).map((s: { state: string }) => s.state)).toEqual([
      'sold',
      'sold',
    ]);
    expect(await testRedis.exists(holdKey(trip.id, 2), holdKey(trip.id, 3))).toBe(0);
    expect(await testRedis.zscore(EXPIRY_KEY, holdMember(trip.id, 2))).toBeNull();
    expect(events.log.map((e) => e.type)).toEqual(['held', 'held', 'sold']);
    expect(events.log.at(-1)).toEqual({ type: 'sold', tripId: trip.id, seatNumbers: [2, 3] });
  });

  describe('idempotence', () => {
    it('la même clé renvoie la même réservation, sans en créer une deuxième', async () => {
      const trip = await createTrip();
      const { user, header } = await authAs();
      await holdSeats(trip.id, header, [5]);
      const key = randomUUID();
      const body = { tripId: trip.id, passengers: passengers([5]) };

      const first = await book(body, header, key).expect(201);
      const again = await book(body, header, key).expect(201);

      expect(again.body).toEqual(first.body);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(await testDb.booking.count({ where: { userId: user.id } })).toBe(1);
      expect(events.log.filter((e) => e.type === 'sold')).toHaveLength(1);
    });

    it('double clic : deux envois simultanés, une seule réservation', async () => {
      const trip = await createTrip();
      const { user, header } = await authAs();
      await holdSeats(trip.id, header, [5, 6]);
      const key = randomUUID();
      const body = { tripId: trip.id, passengers: passengers([5, 6]) };

      const [a, b] = await Promise.all([book(body, header, key), book(body, header, key)]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).toBe(b.body.id);
      expect(await testDb.booking.count({ where: { userId: user.id } })).toBe(1);
      expect(await testDb.ticket.count({ where: { tripId: trip.id } })).toBe(2);
    });

    it('409 IDEMPOTENCY_KEY_REUSED si la même clé sert à une autre demande', async () => {
      const trip = await createTrip();
      const { header } = await authAs();
      await holdSeats(trip.id, header, [5, 6]);
      const key = randomUUID();
      await book({ tripId: trip.id, passengers: passengers([5]) }, header, key).expect(201);

      const res = await book({ tripId: trip.id, passengers: passengers([6]) }, header, key).expect(
        409,
      );

      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('la clé est propre à chaque voyageur', async () => {
      const trip = await createTrip();
      const a = await authAs();
      const b = await authAs();
      await holdSeats(trip.id, a.header, [1]);
      await holdSeats(trip.id, b.header, [2]);

      const ra = await book(
        { tripId: trip.id, passengers: passengers([1]) },
        a.header,
        'meme-cle-123',
      );
      const rb = await book(
        { tripId: trip.id, passengers: passengers([2]) },
        b.header,
        'meme-cle-123',
      );

      expect([ra.status, rb.status]).toEqual([201, 201]);
      expect(ra.body.id).not.toBe(rb.body.id);
    });

    it('400 sans en-tête Idempotency-Key ou avec une clé invalide', async () => {
      const trip = await createTrip();
      const { header } = await authAs();
      const body = { tripId: trip.id, passengers: passengers([1]) };

      const missing = await book(body, header, null).expect(400);
      expect(missing.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { header: 'Idempotency-Key' },
      });
      await book(body, header, 'court').expect(400);
    });
  });

  describe('blocages', () => {
    it('409 HOLD_EXPIRED si la place n’est pas bloquée, ou bloquée par un autre', async () => {
      const trip = await createTrip();
      const me = await authAs();
      const other = await authAs();
      await holdSeats(trip.id, me.header, [1]);
      await holdSeats(trip.id, other.header, [2]);

      const res = await book(
        { tripId: trip.id, passengers: passengers([1, 2, 3]) },
        me.header,
      ).expect(409);

      expect(res.body.error).toMatchObject({
        code: 'HOLD_EXPIRED',
        details: { seatNumbers: [2, 3] },
      });
      expect(await testDb.booking.count()).toBe(0);
    });

    it('409 HOLD_EXPIRED s’il reste moins de 5 secondes de blocage', async () => {
      const shortHolds = buildTestApp({ holdTtlMs: 4000 });
      const trip = await createTrip();
      const { header } = await authAs();
      await holdSeats(trip.id, header, [1], shortHolds);

      const res = await book({ tripId: trip.id, passengers: passengers([1]) }, header).expect(409);

      expect(res.body.error.code).toBe('HOLD_EXPIRED');
    });

    it('409 SEAT_SOLD si la base refuse le billet, même quand Redis dit la place bloquée', async () => {
      // Redis a « perdu » l'information (panne, clé effacée…) : seule la base protège encore.
      const trip = await createTrip();
      const { user, header } = await authAs();
      await holdSeats(trip.id, header, [4]);
      await sellSeats(trip.id, [4]);

      const res = await book({ tripId: trip.id, passengers: passengers([4]) }, header).expect(409);

      expect(res.body.error).toMatchObject({ code: 'SEAT_SOLD', details: { seatNumbers: [4] } });
      expect(await testDb.booking.count({ where: { userId: user.id } })).toBe(0);
      expect(events.log.filter((e) => e.type === 'sold')).toEqual([]);
    });
  });

  it('409 TRIP_CLOSED si le départ a été annulé entre-temps', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    await holdSeats(trip.id, header, [1]);
    await testDb.trip.update({ where: { id: trip.id }, data: { status: 'cancelled' } });

    const res = await book({ tripId: trip.id, passengers: passengers([1]) }, header).expect(409);

    expect(res.body.error.code).toBe('TRIP_CLOSED');
  });

  it('404 pour un trajet inconnu', async () => {
    const { header } = await authAs();

    await book(
      { tripId: '00000000-0000-4000-8000-000000000000', passengers: passengers([1]) },
      header,
    ).expect(404);
  });

  it.each([
    ['place hors du car', [99]],
    ['place en double', [1, 1]],
    ['plus de 4 passagers', [1, 2, 3, 4, 5]],
    ['aucun passager', []],
  ])('400 : %s', async (_label, seats) => {
    const trip = await createTrip({ seatCount: 15 });
    const { header } = await authAs();

    const res = await book({ tripId: trip.id, passengers: passengers(seats) }, header).expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 : nom de passager vide ou champ inconnu', async () => {
    const trip = await createTrip();
    const { header } = await authAs();

    await book(
      { tripId: trip.id, passengers: [{ seatNumber: 1, passengerName: ' ' }] },
      header,
    ).expect(400);
    await book({ tripId: trip.id, passengers: passengers([1]), totalFcfa: 0 }, header).expect(400);
  });

  it('401 sans jeton, 403 pour un contrôleur', async () => {
    const trip = await createTrip();
    const body = { tripId: trip.id, passengers: passengers([1]) };

    await request(app)
      .post('/api/v1/bookings')
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(401);
    await book(body, (await authAs('controller')).header).expect(403);
  });
});

describe('GET /api/v1/bookings/me', () => {
  it('liste mes réservations, la plus récente d’abord, jamais celles des autres', async () => {
    const tripA = await createTrip();
    const tripB = await createTrip({ departureAt: new Date(Date.now() + 2 * 86_400_000) });
    const me = await authAs();
    const other = await authAs();
    await holdSeats(tripA.id, me.header, [1]);
    const first = await book({ tripId: tripA.id, passengers: passengers([1]) }, me.header);
    await holdSeats(tripB.id, me.header, [2]);
    const second = await book({ tripId: tripB.id, passengers: passengers([2]) }, me.header);
    await holdSeats(tripA.id, other.header, [3]);
    await book({ tripId: tripA.id, passengers: passengers([3]) }, other.header).expect(201);

    const res = await request(app)
      .get('/api/v1/bookings/me')
      .set('Authorization', me.header)
      .expect(200);

    const { bookings } = myBookingsResponseSchema.parse(res.body);
    expect(bookings.map((b) => b.id)).toEqual([second.body.id, first.body.id]);
    expect(bookings[0]?.tickets[0]?.seatNumber).toBe(2);
  });

  it('liste vide pour un nouveau voyageur ; 401 sans jeton ; 403 pour un contrôleur', async () => {
    const res = await request(app)
      .get('/api/v1/bookings/me')
      .set('Authorization', (await authAs()).header)
      .expect(200);
    expect(res.body).toEqual({ bookings: [] });

    await request(app).get('/api/v1/bookings/me').expect(401);
    await request(app)
      .get('/api/v1/bookings/me')
      .set('Authorization', (await authAs('controller')).header)
      .expect(403);
  });
});
