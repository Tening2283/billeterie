import { isValidSeatNumber } from '@billetterie/shared';
import { z } from 'zod';
import { AppError } from '../lib/app-error';
import type { Db } from '../lib/db';
import type { Prisma } from '../generated/prisma/client';

const uuid = z.uuid();

export type TripWithBus = Prisma.TripGetPayload<{ include: { bus: true } }>;

/**
 * Règles communes au blocage et à la réservation : le trajet existe (404), les places existent
 * dans ce car (400), le départ est programmé et pas encore parti (409 TRIP_CLOSED).
 */
export async function findBookableTrip(
  db: Db,
  tripId: string,
  seatNumbers: number[],
  now: number,
): Promise<TripWithBus> {
  const trip = uuid.safeParse(tripId).success
    ? await db.trip.findUnique({ where: { id: tripId }, include: { bus: true } })
    : null;
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Ce trajet est introuvable.');

  const outside = seatNumbers.filter((n) => !isValidSeatNumber(n, trip.bus.seatCount));
  if (outside.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', "Cette place n'existe pas dans ce car.", {
      seatNumbers: outside,
      seatCount: trip.bus.seatCount,
    });
  }
  if (trip.status !== 'scheduled' || trip.departureAt.getTime() <= now) {
    throw new AppError(409, 'TRIP_CLOSED', "Ce départ n'est plus ouvert à la réservation.");
  }
  return trip;
}
