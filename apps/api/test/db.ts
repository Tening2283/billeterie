import { afterAll, beforeAll } from 'vitest';
import type { BusLayout } from '@billetterie/shared';
import { createDb } from '../src/lib/db';
import { warmUp } from './warm-up';

export const testDb = createDb(process.env.DATABASE_URL!);

beforeAll(() => warmUp('PostgreSQL', () => testDb.$queryRaw`SELECT 1`), 60_000);

afterAll(async () => {
  await testDb.$disconnect();
});

/** Vide toutes les tables (appelé avant chaque test d'intégration). */
export async function resetDb(): Promise<void> {
  await testDb.$executeRaw`TRUNCATE tickets, bookings, trips, buses, routes, users CASCADE`;
}

let counter = 0;
const unique = () => `${Date.now()}-${++counter}`;

export async function createBus(seatCount = 15, layout?: BusLayout) {
  return testDb.bus.create({
    data: {
      name: `Car ${unique()}`,
      seatCount,
      layout: layout ?? { rows: Math.ceil(seatCount / 3), columns: 3, aisleAfter: 1 },
    },
  });
}

export async function createRoute(origin = 'Dakar', destination = 'Thiès') {
  return testDb.route.upsert({
    where: { origin_destination: { origin, destination } },
    create: { origin, destination },
    update: {},
  });
}

export async function createTrip(
  options: {
    departureAt?: Date;
    origin?: string;
    destination?: string;
    seatCount?: number;
    priceFcfa?: number;
    status?: 'scheduled' | 'cancelled';
  } = {},
) {
  const route = await createRoute(options.origin, options.destination);
  const bus = await createBus(options.seatCount);
  return testDb.trip.create({
    data: {
      routeId: route.id,
      busId: bus.id,
      departureAt: options.departureAt ?? new Date(Date.now() + 86_400_000),
      priceFcfa: options.priceFcfa ?? 2000,
      status: options.status ?? 'scheduled',
    },
  });
}

export async function createUser(role: 'traveler' | 'controller' | 'admin' = 'traveler') {
  return testDb.user.create({
    data: { email: `u-${unique()}@test.local`, name: 'Test', passwordHash: 'x', role },
  });
}

/** Réservation confirmée avec un billet par place (sans passer par Redis). */
export async function sellSeats(
  tripId: string,
  seatNumbers: number[],
  status: 'valid' | 'used' | 'cancelled' = 'valid',
  userId?: string,
) {
  return testDb.booking.create({
    data: {
      userId: userId ?? (await createUser()).id,
      tripId,
      totalFcfa: 0,
      idempotencyKey: unique(),
      tickets: {
        create: seatNumbers.map((seatNumber) => ({
          tripId,
          seatNumber,
          passengerName: `Passager ${seatNumber}`,
          status,
        })),
      },
    },
    include: { tickets: true },
  });
}

/** Date UTC de demain à l'heure donnée, et la date AAAA-MM-JJ correspondante. */
export function tomorrowAt(hour: number): { at: Date; date: string } {
  const d = new Date();
  const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hour));
  return { at, date: at.toISOString().slice(0, 10) };
}
