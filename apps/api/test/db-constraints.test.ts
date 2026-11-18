import { beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/lib/db';
import { createBus, createTrip, resetDb, sellSeats } from './db';

beforeEach(resetDb);

describe('index unique partiel tickets_one_active_per_seat', () => {
  it('refuse un second billet actif pour la même place du même trajet', async () => {
    const trip = await createTrip();
    await sellSeats(trip.id, [5]);

    const error = await sellSeats(trip.id, [5]).catch((e: unknown) => e);

    expect(isUniqueViolation(error)).toBe(true);
  });

  it('accepte de revendre une place dont le billet a été annulé', async () => {
    const trip = await createTrip();
    await sellSeats(trip.id, [5], 'cancelled');

    await expect(sellSeats(trip.id, [5])).resolves.toBeDefined();
  });

  it('un billet utilisé bloque toujours la place', async () => {
    const trip = await createTrip();
    await sellSeats(trip.id, [5], 'used');

    const error = await sellSeats(trip.id, [5]).catch((e: unknown) => e);

    expect(isUniqueViolation(error)).toBe(true);
  });

  it('la même place sur deux trajets différents ne pose pas de problème', async () => {
    const [a, b] = [
      await createTrip(),
      await createTrip({ departureAt: new Date(Date.now() + 2 * 86_400_000) }),
    ];
    await sellSeats(a.id, [5]);

    await expect(sellSeats(b.id, [5])).resolves.toBeDefined();
  });
});

describe('contraintes CHECK', () => {
  it('refuse un car sans places et un prix négatif', async () => {
    await expect(createBus(0)).rejects.toThrow();
    await expect(createTrip({ priceFcfa: -1 })).rejects.toThrow();
  });
});

describe('isUniqueViolation', () => {
  it.each([
    [{ code: 'P2002' }, true],
    [{ code: '23505' }, true],
    [{ code: 'X', cause: { code: '23505' } }, true],
    [{ code: 'P2025' }, false],
    [new Error('autre'), false],
    [null, false],
    ['P2002', false],
  ])('%j → %s', (error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });
});
