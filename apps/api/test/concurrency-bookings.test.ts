import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AppError } from '../src/lib/app-error';
import { createBookingWithTickets } from '../src/services/bookings';
import { createTrip, createUser, resetDb, sellSeats, testDb } from './db';
import { authAs, buildTestApp, testSigner } from './helpers';

beforeEach(resetDb);

/** Test de concurrence n° 2 du cahier des charges : la base suffit si Redis tombe. */
describe('sans Redis : 50 ventes simultanées de la même place', () => {
  it('une seule réussit, les 49 autres reçoivent SEAT_SOLD et ne laissent aucune trace', async () => {
    const N = 50;
    const trip = await createTrip({ seatCount: 50 });
    const buyers = await Promise.all(Array.from({ length: N }, () => createUser()));

    // Appel direct du service de création de billets : aucun blocage Redis n'est vérifié.
    const results = await Promise.allSettled(
      buyers.map((buyer, i) =>
        createBookingWithTickets(testDb, {
          userId: buyer.id,
          tripId: trip.id,
          idempotencyKey: `concurrence-${i}`,
          totalFcfa: 2000,
          passengers: [{ seatNumber: 7, passengerName: `Acheteur ${i}` }],
        }),
      ),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(N - 1);
    for (const { reason } of lost) {
      expect(reason).toBeInstanceOf(AppError);
      expect(reason).toMatchObject({ status: 409, code: 'SEAT_SOLD' });
    }

    // Les transactions perdantes ont été annulées en entier : pas de réservation orpheline.
    expect(await testDb.booking.count({ where: { tripId: trip.id } })).toBe(1);
    expect(
      await testDb.ticket.count({ where: { tripId: trip.id, seatNumber: 7, status: 'valid' } }),
    ).toBe(1);
  });
});

/** Test de concurrence n° 3 du cahier des charges. */
describe('double scan du même billet', () => {
  const app = buildTestApp();

  async function scanTogether(times: number) {
    const trip = await createTrip();
    const { tickets } = await sellSeats(trip.id, [3]);
    const code = testSigner.sign(tickets[0]!.id);
    const controllers = await Promise.all(
      Array.from({ length: times }, () => authAs('controller')),
    );

    const responses = await Promise.all(
      controllers.map(({ header }) =>
        request(app).post('/api/v1/tickets/verify').set('Authorization', header).send({ code }),
      ),
    );
    return responses.map((r) => r.body.result as string);
  }

  it('deux contrôleurs à la même seconde : un « valid » et un « already_used »', async () => {
    expect((await scanTogether(2)).sort()).toEqual(['already_used', 'valid']);
  });

  it('dix scans simultanés : toujours un seul « valid »', async () => {
    const results = await scanTogether(10);

    expect(results.filter((r) => r === 'valid')).toHaveLength(1);
    expect(results.filter((r) => r === 'already_used')).toHaveLength(9);
  });
});
