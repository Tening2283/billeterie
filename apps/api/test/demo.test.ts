import { beforeEach, describe, expect, it } from 'vitest';
import { buildSeatPositions } from '@billetterie/shared';
import { DEMO_BUSES, DEMO_LINES, DEMO_USERS } from '../src/demo/catalog';
import { seedDemoCatalog } from '../src/demo/seed-catalog';
import { ensureUpcomingTrips } from '../src/demo/ensure-upcoming-trips';
import { resetDb, testDb } from './db';

beforeEach(resetDb);

describe('catalogue de démo', () => {
  it('chaque car a un plan cohérent avec son nombre de places', () => {
    for (const bus of DEMO_BUSES) {
      expect(buildSeatPositions(bus.layout, bus.seatCount)).toHaveLength(bus.seatCount);
    }
  });

  it('chaque ligne existe dans les deux sens et utilise un car connu', () => {
    const keys = new Set(DEMO_LINES.map((l) => `${l.origin}→${l.destination}`));
    for (const line of DEMO_LINES) {
      expect(keys.has(`${line.destination}→${line.origin}`)).toBe(true);
      expect(DEMO_BUSES.some((b) => b.name === line.busName)).toBe(true);
    }
  });
});

describe('seedDemoCatalog', () => {
  it('crée cars, lignes et comptes, et peut être relancé sans doublon', async () => {
    await seedDemoCatalog(testDb, { bcryptCost: 4 });
    await seedDemoCatalog(testDb, { bcryptCost: 4 });

    expect(await testDb.bus.count()).toBe(DEMO_BUSES.length);
    expect(await testDb.route.count()).toBe(DEMO_LINES.length);
    const users = await testDb.user.findMany({ orderBy: { email: 'asc' } });
    expect(users.map((u) => [u.email, u.role])).toEqual(
      DEMO_USERS.map((u) => [u.email, u.role]).sort(),
    );
    expect(users[0]?.passwordHash).toMatch(/^\$2[aby]\$04\$/);
  });
});

describe('ensureUpcomingTrips', () => {
  const now = new Date('2030-03-10T12:30:00.000Z');

  it('crée les départs à venir des N prochains jours, sans ceux déjà passés', async () => {
    await seedDemoCatalog(testDb, { bcryptCost: 4 });

    const created = await ensureUpcomingTrips(testDb, { days: 2, now });

    const perDay = DEMO_LINES.reduce((n, l) => n + l.departureHours.length, 0);
    const pastToday = DEMO_LINES.reduce(
      (n, l) => n + l.departureHours.filter((h) => h <= 12).length,
      0,
    );
    expect(created).toBe(2 * perDay - pastToday);

    const first = await testDb.trip.findFirst({ orderBy: { departureAt: 'asc' } });
    expect(first!.departureAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('est idempotent', async () => {
    await seedDemoCatalog(testDb, { bcryptCost: 4 });
    await ensureUpcomingTrips(testDb, { days: 2, now });

    expect(await ensureUpcomingTrips(testDb, { days: 2, now })).toBe(0);
  });

  it('ignore les lignes dont la route ou le car n’existent pas encore', async () => {
    expect(await ensureUpcomingTrips(testDb, { days: 2, now })).toBe(0);
  });

  it('utilise le prix de la ligne et l’heure de Dakar (UTC)', async () => {
    await seedDemoCatalog(testDb, { bcryptCost: 4 });
    const line = DEMO_LINES[0]!;
    await ensureUpcomingTrips(testDb, { days: 2, now, lines: [line] });

    const trips = await testDb.trip.findMany({ orderBy: { departureAt: 'asc' } });
    expect(trips.every((t) => t.priceFcfa === line.priceFcfa)).toBe(true);
    expect(trips.map((t) => t.departureAt.getUTCHours())).toEqual([
      ...line.departureHours.filter((h) => h > 12),
      ...line.departureHours,
    ]);
  });
});
