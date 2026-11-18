import {
  busLayoutSchema,
  remainingSeats,
  type SearchTripsQuery,
  type SeatStatus,
  type TripDetail,
  type TripSummary,
} from '@billetterie/shared';
import { z } from 'zod';
import type { Db } from '../lib/db';
import type { Prisma } from '../generated/prisma/client';
import type { HoldService } from './holds';

const DAY_MS = 86_400_000;
const uuid = z.uuid();

type TripWithRelations = Prisma.TripGetPayload<{ include: { route: true; bus: true } }>;

/** Nombre de billets actifs (non annulés) par trajet : ce sont les places vendues. */
async function soldCountByTrip(db: Db, tripIds: string[]): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const groups = await db.ticket.groupBy({
    by: ['tripId'],
    where: { tripId: { in: tripIds }, status: { not: 'cancelled' } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.tripId, g._count._all]));
}

function toSummary(trip: TripWithRelations, sold: number): TripSummary {
  return {
    id: trip.id,
    origin: trip.route.origin,
    destination: trip.route.destination,
    departureAt: trip.departureAt.toISOString(),
    priceFcfa: trip.priceFcfa,
    busName: trip.bus.name,
    seatCount: trip.bus.seatCount,
    remainingSeats: remainingSeats(trip.bus.seatCount, sold),
  };
}

/**
 * Départs programmés d'une ligne pour une journée (heure de Dakar = UTC),
 * sans ceux qui sont déjà partis.
 */
export async function searchTrips(
  db: Db,
  query: SearchTripsQuery,
  now = new Date(),
): Promise<TripSummary[]> {
  const dayStart = new Date(`${query.date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const from = dayStart > now ? dayStart : now;

  const trips = await db.trip.findMany({
    where: {
      status: 'scheduled',
      departureAt: { gte: from, lt: dayEnd },
      route: {
        origin: { equals: query.from, mode: 'insensitive' },
        destination: { equals: query.to, mode: 'insensitive' },
      },
    },
    include: { route: true, bus: true },
    orderBy: { departureAt: 'asc' },
  });

  const sold = await soldCountByTrip(
    db,
    trips.map((t) => t.id),
  );
  return trips.map((trip) => toSummary(trip, sold.get(trip.id) ?? 0));
}

async function findTrip(db: Db, id: string): Promise<TripWithRelations | null> {
  // Un identifiant mal formé ne peut correspondre à aucun trajet : 404, pas 400.
  if (!uuid.safeParse(id).success) return null;
  return db.trip.findUnique({ where: { id }, include: { route: true, bus: true } });
}

export async function getTrip(db: Db, id: string): Promise<TripDetail | null> {
  const trip = await findTrip(db, id);
  if (!trip) return null;
  const sold = await soldCountByTrip(db, [trip.id]);
  return {
    ...toSummary(trip, sold.get(trip.id) ?? 0),
    status: trip.status,
    layout: busLayoutSchema.parse(trip.bus.layout),
  };
}

/**
 * État de chaque place : vendue (PostgreSQL) > bloquée (Redis) > libre.
 * `heldByMe` n'est vrai que pour l'utilisateur connecté (`viewerId`) ; anonyme : toujours faux.
 */
export async function getTripSeats(
  db: Db,
  holds: HoldService,
  id: string,
  viewerId?: string,
): Promise<SeatStatus[] | null> {
  const trip = await findTrip(db, id);
  if (!trip) return null;

  const [soldTickets, held] = await Promise.all([
    db.ticket.findMany({
      where: { tripId: trip.id, status: { not: 'cancelled' } },
      select: { seatNumber: true },
    }),
    holds.seatHolds(trip.id, trip.bus.seatCount),
  ]);
  const sold = new Set(soldTickets.map((t) => t.seatNumber));

  return Array.from({ length: trip.bus.seatCount }, (_, i): SeatStatus => {
    const seatNumber = i + 1;
    if (sold.has(seatNumber)) {
      return { seatNumber, state: 'sold', heldByMe: false, expiresAt: null };
    }
    const hold = held.get(seatNumber);
    if (hold) {
      return {
        seatNumber,
        state: 'held',
        heldByMe: viewerId !== undefined && hold.userId === viewerId,
        expiresAt: hold.expiresAt?.toISOString() ?? null,
      };
    }
    return { seatNumber, state: 'free', heldByMe: false, expiresAt: null };
  });
}
