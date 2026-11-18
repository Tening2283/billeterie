import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/app-error';
import { createBookingService, createBookingWithTickets } from '../src/services/bookings';
import type { HoldService } from '../src/services/holds';
import { createTrip, createUser, resetDb, testDb } from './db';
import { recordingEvents, silentLogger } from './helpers';

beforeEach(resetDb);

/** Blocages simulés : on contrôle précisément ce qui se passe entre les étapes de la réservation. */
function fakeHolds(overrides: Partial<HoldService>): HoldService {
  return {
    hold: vi.fn(),
    release: vi.fn(),
    seatHolds: vi.fn(),
    assertHeldBy: vi.fn(async () => {}),
    releaseAfterSale: vi.fn(async () => {}),
    ...overrides,
  };
}

const passengers = [{ seatNumber: 2, passengerName: 'Awa Diop' }];

describe('createBookingService : cas limites', () => {
  it('double clic : si l’autre requête vend et libère les places pendant la vérification, on renvoie sa réservation', async () => {
    const trip = await createTrip();
    const user = await createUser();
    const key = 'double-clic-123';
    const holds = fakeHolds({
      // Pendant notre vérification des blocages, la requête jumelle termine : vente + libération.
      assertHeldBy: vi.fn(async () => {
        await createBookingWithTickets(testDb, {
          userId: user.id,
          tripId: trip.id,
          idempotencyKey: key,
          totalFcfa: trip.priceFcfa,
          passengers,
        });
        throw new AppError(409, 'HOLD_EXPIRED', 'expiré', { seatNumbers: [2] });
      }),
    });
    const service = createBookingService({
      db: testDb,
      holds,
      events: recordingEvents(),
      logger: silentLogger,
    });

    const result = await service.create(user.id, key, { tripId: trip.id, passengers });

    expect(result.replayed).toBe(true);
    expect(result.booking.tickets.map((t) => t.seatNumber)).toEqual([2]);
    expect(await testDb.booking.count()).toBe(1);
  });

  it('blocage réellement expiré (aucune réservation jumelle) : l’erreur HOLD_EXPIRED remonte', async () => {
    const trip = await createTrip();
    const user = await createUser();
    const expired = new AppError(409, 'HOLD_EXPIRED', 'expiré', { seatNumbers: [2] });
    const service = createBookingService({
      db: testDb,
      holds: fakeHolds({ assertHeldBy: vi.fn(async () => Promise.reject(expired)) }),
      events: recordingEvents(),
      logger: silentLogger,
    });

    await expect(
      service.create(user.id, 'cle-expiree-1', { tripId: trip.id, passengers }),
    ).rejects.toBe(expired);
  });

  it('Redis tombe juste après la vente : la réservation est quand même confirmée et annoncée', async () => {
    const trip = await createTrip();
    const user = await createUser();
    const events = recordingEvents();
    const error = vi.fn();
    const service = createBookingService({
      db: testDb,
      holds: fakeHolds({
        releaseAfterSale: vi.fn(async () => Promise.reject(new Error('Redis injoignable'))),
      }),
      events,
      logger: { ...silentLogger, error } as unknown as typeof silentLogger,
    });

    const result = await service.create(user.id, 'redis-en-panne', { tripId: trip.id, passengers });

    expect(result.replayed).toBe(false);
    expect(await testDb.booking.count()).toBe(1);
    expect(events.log).toEqual([{ type: 'sold', tripId: trip.id, seatNumbers: [2] }]);
    expect(error).toHaveBeenCalledOnce();
  });

  it('une erreur de base autre qu’une violation d’unicité n’est pas maquillée en SEAT_SOLD', async () => {
    const user = await createUser();

    // Trajet inexistant : la clé étrangère refuse l'insertion (P2003), ce n'est pas une double vente.
    const attempt = createBookingWithTickets(testDb, {
      userId: user.id,
      tripId: '00000000-0000-4000-8000-000000000000',
      idempotencyKey: 'trajet-fantome',
      totalFcfa: 0,
      passengers,
    });

    await expect(attempt).rejects.not.toBeInstanceOf(AppError);
  });
});
