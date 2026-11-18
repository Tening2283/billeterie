import { beforeEach, describe, expect, it } from 'vitest';
import { searchTrips } from '../src/services/trips';
import { createTrip, resetDb, testDb } from './db';

beforeEach(resetDb);

describe('searchTrips', () => {
  it('n’affiche pas les départs déjà partis de la journée en cours', async () => {
    const now = new Date('2030-03-10T12:00:00.000Z');
    await createTrip({ departureAt: new Date('2030-03-10T08:00:00.000Z') });
    const afternoon = await createTrip({ departureAt: new Date('2030-03-10T15:00:00.000Z') });

    const trips = await searchTrips(
      testDb,
      { from: 'Dakar', to: 'Thiès', date: '2030-03-10' },
      now,
    );

    expect(trips.map((t) => t.id)).toEqual([afternoon.id]);
  });

  it('borne la journée en UTC (heure de Dakar) : 00:00 inclus, minuit suivant exclu', async () => {
    const midnight = await createTrip({ departureAt: new Date('2030-03-10T00:00:00.000Z') });
    await createTrip({ departureAt: new Date('2030-03-11T00:00:00.000Z') });

    const trips = await searchTrips(
      testDb,
      { from: 'Dakar', to: 'Thiès', date: '2030-03-10' },
      new Date('2030-03-01T00:00:00.000Z'),
    );

    expect(trips.map((t) => t.id)).toEqual([midnight.id]);
  });
});
