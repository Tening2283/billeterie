import type { Logger } from 'pino';
import type { Booking, CreateBookingBody, Passenger } from '@billetterie/shared';
import { AppError } from '../lib/app-error';
import { isUniqueViolation, type Db } from '../lib/db';
import type { SeatEvents } from '../realtime/seat-events';
import type { Prisma } from '../generated/prisma/client';
import { findBookableTrip } from './bookable-trip';
import type { HoldService } from './holds';

const BOOKING_INCLUDE = {
  tickets: { orderBy: { seatNumber: 'asc' } },
  trip: { include: { route: true, bus: true } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

export function toBookingDto(booking: BookingWithRelations): Booking {
  return {
    id: booking.id,
    status: booking.status,
    totalFcfa: booking.totalFcfa,
    createdAt: booking.createdAt.toISOString(),
    trip: {
      id: booking.trip.id,
      origin: booking.trip.route.origin,
      destination: booking.trip.route.destination,
      departureAt: booking.trip.departureAt.toISOString(),
      busName: booking.trip.bus.name,
    },
    tickets: booking.tickets.map((t) => ({
      id: t.id,
      seatNumber: t.seatNumber,
      passengerName: t.passengerName,
      status: t.status,
      usedAt: t.usedAt?.toISOString() ?? null,
    })),
  };
}

function findByIdempotencyKey(db: Db, userId: string, idempotencyKey: string) {
  return db.booking.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: BOOKING_INCLUDE,
  });
}

export interface NewBooking {
  userId: string;
  tripId: string;
  idempotencyKey: string;
  totalFcfa: number;
  passengers: Passenger[];
}

export type SaleResult =
  | { kind: 'created'; booking: BookingWithRelations }
  /** La même tentative (même utilisateur, même clé) a été enregistrée par une requête concurrente. */
  | { kind: 'duplicate'; booking: BookingWithRelations };

/**
 * Crée la réservation et ses billets dans UNE transaction : tout ou rien.
 * C'est la garantie finale contre la double vente, indépendante de Redis : si une place a déjà
 * un billet actif, l'index unique partiel `tickets_one_active_per_seat` refuse l'insertion
 * (Prisma P2002 / PostgreSQL 23505), toute la transaction est annulée et on répond 409 SEAT_SOLD.
 */
export async function createBookingWithTickets(db: Db, sale: NewBooking): Promise<SaleResult> {
  const { userId, tripId, idempotencyKey, totalFcfa, passengers } = sale;
  try {
    const booking = await db.$transaction(
      (tx) =>
        tx.booking.create({
          data: {
            userId,
            tripId,
            totalFcfa,
            idempotencyKey,
            tickets: {
              create: passengers.map(({ seatNumber, passengerName }) => ({
                tripId,
                seatNumber,
                passengerName,
              })),
            },
          },
          include: BOOKING_INCLUDE,
        }),
      // Attente d'une connexion libre quand beaucoup de ventes arrivent ensemble (test de concurrence
      // n° 2 : 50 en même temps, depuis Dakar vers Frankfurt). En production (même région), négligeable.
      { maxWait: 10_000, timeout: 10_000 },
    );
    return { kind: 'created', booking };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    // Deux contraintes uniques peuvent refuser l'insertion : (user_id, idempotency_key), si la même
    // tentative a été enregistrée en parallèle, ou l'index des places, si une place est déjà vendue.
    const existing = await findByIdempotencyKey(db, userId, idempotencyKey);
    if (existing) return { kind: 'duplicate', booking: existing };

    const sold = await db.ticket.findMany({
      where: {
        tripId,
        seatNumber: { in: passengers.map((p) => p.seatNumber) },
        status: { not: 'cancelled' },
      },
      select: { seatNumber: true },
      orderBy: { seatNumber: 'asc' },
    });
    throw new AppError(409, 'SEAT_SOLD', "Une des places vient d'être vendue.", {
      seatNumbers: sold.map((t) => t.seatNumber),
    });
  }
}

/** Une requête rejouée doit être identique : même trajet, mêmes places, mêmes passagers. */
function isSameRequest(booking: BookingWithRelations, input: CreateBookingBody): boolean {
  if (booking.tripId !== input.tripId || booking.tickets.length !== input.passengers.length) {
    return false;
  }
  return input.passengers.every((p) =>
    booking.tickets.some(
      (t) => t.seatNumber === p.seatNumber && t.passengerName === p.passengerName,
    ),
  );
}

export interface BookingService {
  create(
    userId: string,
    idempotencyKey: string,
    input: CreateBookingBody,
  ): Promise<{ booking: Booking; replayed: boolean }>;
  listForUser(userId: string): Promise<Booking[]>;
}

export interface BookingServiceDeps {
  db: Db;
  holds: HoldService;
  events: SeatEvents;
  logger: Logger;
  now?: () => number;
}

export function createBookingService({
  db,
  holds,
  events,
  logger,
  now = Date.now,
}: BookingServiceDeps): BookingService {
  function replay(booking: BookingWithRelations, input: CreateBookingBody) {
    if (!isSameRequest(booking, input)) {
      throw new AppError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        "Cette clé d'idempotence a déjà servi pour une autre réservation.",
      );
    }
    return { booking: toBookingDto(booking), replayed: true };
  }

  return {
    async create(userId, idempotencyKey, input) {
      // 1. Idempotence : cette tentative a-t-elle déjà abouti ? Alors même réponse, rien de nouveau.
      const previous = await findByIdempotencyKey(db, userId, idempotencyKey);
      if (previous) return replay(previous, input);

      const seatNumbers = input.passengers.map((p) => p.seatNumber).sort((a, b) => a - b);
      const trip = await findBookableTrip(db, input.tripId, seatNumbers, now());

      // 2. Chaque place est bloquée par cet utilisateur, avec au moins 5 s de marge.
      try {
        await holds.assertHeldBy(userId, trip.id, seatNumbers);
      } catch (error) {
        // Double clic : l'autre requête a pu vendre ET libérer les places entre notre étape 1 et
        // celle-ci. Ce n'est pas un blocage expiré, c'est la même réservation : on la renvoie.
        const concurrent = await findByIdempotencyKey(db, userId, idempotencyKey);
        if (concurrent) return replay(concurrent, input);
        throw error;
      }

      // 3. Réservation + billets dans une transaction (la base refuse toute double vente).
      const sale = await createBookingWithTickets(db, {
        userId,
        tripId: trip.id,
        idempotencyKey,
        totalFcfa: trip.priceFcfa * seatNumbers.length,
        passengers: input.passengers,
      });
      if (sale.kind === 'duplicate') return replay(sale.booking, input);

      // 4. Après la validation de la transaction seulement : libérer les blocages, prévenir la salle.
      try {
        await holds.releaseAfterSale(userId, trip.id, seatNumbers);
      } catch (err) {
        // La vente est enregistrée : un échec Redis ici ne doit pas la faire paraître ratée.
        // Les blocages expireront seuls ; une nouvelle tentative de blocage serait refusée (billet en base).
        logger.error({ err, tripId: trip.id }, 'Blocages non libérés après la vente');
      }
      events.sold(trip.id, seatNumbers);

      return { booking: toBookingDto(sale.booking), replayed: false };
    },

    async listForUser(userId) {
      const bookings = await db.booking.findMany({
        where: { userId },
        include: BOOKING_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      return bookings.map(toBookingDto);
    },
  };
}
