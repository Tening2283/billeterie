import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  searchTripsResponseSchema,
  tripDetailSchema,
  tripSeatsResponseSchema,
} from '@billetterie/shared';
import { createTrip, resetDb, sellSeats, tomorrowAt } from './db';
import { buildTestApp } from './helpers';

const app = buildTestApp();

beforeEach(resetDb);

describe('GET /api/v1/trips', () => {
  it('liste les départs du jour, triés par heure, avec les places restantes', async () => {
    const { at: at10, date } = tomorrowAt(10);
    const { at: at7 } = tomorrowAt(7);
    const late = await createTrip({ departureAt: at10, seatCount: 15, priceFcfa: 2000 });
    const early = await createTrip({ departureAt: at7, seatCount: 50, priceFcfa: 2500 });
    await sellSeats(late.id, [1, 2, 3]);
    await sellSeats(late.id, [4], 'cancelled'); // un billet annulé libère la place
    await sellSeats(late.id, [5], 'used'); // un billet utilisé reste une place vendue

    const res = await request(app)
      .get('/api/v1/trips')
      .query({ from: 'Dakar', to: 'Thiès', date })
      .expect(200);

    const { trips } = searchTripsResponseSchema.parse(res.body);
    expect(trips.map((t) => t.id)).toEqual([early.id, late.id]);
    expect(trips[1]).toMatchObject({
      origin: 'Dakar',
      destination: 'Thiès',
      departureAt: at10.toISOString(),
      priceFcfa: 2000,
      seatCount: 15,
      remainingSeats: 11,
    });
    expect(trips[0]?.remainingSeats).toBe(50);
  });

  it('ignore la casse des villes', async () => {
    const { at, date } = tomorrowAt(9);
    await createTrip({ departureAt: at });

    const res = await request(app)
      .get('/api/v1/trips')
      .query({ from: 'dakar', to: 'THIÈS', date })
      .expect(200);

    expect(res.body.trips).toHaveLength(1);
  });

  it('exclut les trajets annulés, les autres jours et les autres lignes', async () => {
    const { at, date } = tomorrowAt(9);
    await createTrip({ departureAt: at, status: 'cancelled' });
    await createTrip({ departureAt: new Date(at.getTime() + 86_400_000) }); // surlendemain
    await createTrip({ departureAt: at, origin: 'Dakar', destination: 'Mbour' });

    const res = await request(app)
      .get('/api/v1/trips')
      .query({ from: 'Dakar', to: 'Thiès', date })
      .expect(200);

    expect(res.body).toEqual({ trips: [] });
  });

  it('400 si un paramètre manque ou si la date est invalide', async () => {
    const missing = await request(app).get('/api/v1/trips').query({ from: 'Dakar' }).expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const badDate = await request(app)
      .get('/api/v1/trips')
      .query({ from: 'Dakar', to: 'Thiès', date: '20/11/2026' })
      .expect(400);
    expect(badDate.body.error.details.issues[0].path).toEqual(['date']);
  });
});

describe('GET /api/v1/trips/:id', () => {
  it('renvoie le trajet et le plan du car', async () => {
    const trip = await createTrip({ seatCount: 15 });
    await sellSeats(trip.id, [7]);

    const res = await request(app).get(`/api/v1/trips/${trip.id}`).expect(200);

    const detail = tripDetailSchema.parse(res.body);
    expect(detail).toMatchObject({
      id: trip.id,
      status: 'scheduled',
      seatCount: 15,
      remainingSeats: 14,
      layout: { rows: 5, columns: 3, aisleAfter: 1 },
    });
  });

  it('404 pour un identifiant inconnu ou mal formé', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'pas-un-uuid']) {
      const res = await request(app).get(`/api/v1/trips/${id}`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('GET /api/v1/trips/:id/seats', () => {
  it('donne l’état de chaque place : vendue ou libre', async () => {
    const trip = await createTrip({ seatCount: 15 });
    await sellSeats(trip.id, [2, 9]);
    await sellSeats(trip.id, [3], 'cancelled');

    const res = await request(app).get(`/api/v1/trips/${trip.id}/seats`).expect(200);

    const { tripId, seats } = tripSeatsResponseSchema.parse(res.body);
    expect(tripId).toBe(trip.id);
    expect(seats).toHaveLength(15);
    expect(seats.filter((s) => s.state === 'sold').map((s) => s.seatNumber)).toEqual([2, 9]);
    expect(seats[2]).toEqual({ seatNumber: 3, state: 'free', heldByMe: false, expiresAt: null });
  });

  it('404 pour un trajet inconnu', async () => {
    await request(app).get('/api/v1/trips/00000000-0000-4000-8000-000000000000/seats').expect(404);
  });
});
