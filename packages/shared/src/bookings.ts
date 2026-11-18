import { z } from 'zod';
import { MAX_HOLDS_PER_TRIP } from './holds';

/**
 * En-tête `Idempotency-Key` : identifie UNE tentative de réservation, générée par le front
 * (ex. `crypto.randomUUID()`). Un double clic ou un renvoi réseau avec la même clé ne crée qu'une réservation.
 */
export const idempotencyKeySchema = z
  .string({ message: 'En-tête Idempotency-Key obligatoire' })
  .min(8, 'Idempotency-Key trop courte (8 caractères minimum)')
  .max(128, 'Idempotency-Key trop longue (128 caractères maximum)')
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency-Key : lettres, chiffres et . _ : - uniquement');

export const passengerSchema = z
  .object({
    seatNumber: z.number().int().positive(),
    passengerName: z
      .string({ message: 'Nom du passager obligatoire' })
      .trim()
      .min(2, 'Au moins 2 caractères')
      .max(80),
  })
  .strict();
export type Passenger = z.infer<typeof passengerSchema>;

export const createBookingBodySchema = z
  .object({
    tripId: z.uuid(),
    passengers: z
      .array(passengerSchema)
      .min(1, 'Au moins un passager')
      .max(MAX_HOLDS_PER_TRIP, `Au plus ${MAX_HOLDS_PER_TRIP} passagers`)
      .refine(
        (list) => new Set(list.map((p) => p.seatNumber)).size === list.length,
        'Une même place ne peut apparaître qu’une fois',
      ),
  })
  .strict();
export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;

export const ticketStatusSchema = z.enum(['valid', 'used', 'cancelled']);
export const bookingStatusSchema = z.enum(['confirmed', 'cancelled']);

export const ticketSchema = z.object({
  id: z.uuid(),
  seatNumber: z.number().int().positive(),
  passengerName: z.string(),
  status: ticketStatusSchema,
  usedAt: z.iso.datetime().nullable(),
});
export type Ticket = z.infer<typeof ticketSchema>;

export const bookingTripSchema = z.object({
  id: z.uuid(),
  origin: z.string(),
  destination: z.string(),
  departureAt: z.iso.datetime(),
  busName: z.string(),
});
export type BookingTrip = z.infer<typeof bookingTripSchema>;

export const bookingSchema = z.object({
  id: z.uuid(),
  status: bookingStatusSchema,
  totalFcfa: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  trip: bookingTripSchema,
  tickets: z.array(ticketSchema),
});
export type Booking = z.infer<typeof bookingSchema>;

export const myBookingsResponseSchema = z.object({ bookings: z.array(bookingSchema) });
export type MyBookingsResponse = z.infer<typeof myBookingsResponseSchema>;

/** Code signé d'un billet, que le front transforme en QR code. */
export const ticketCodeResponseSchema = z.object({ ticketId: z.uuid(), code: z.string() });
export type TicketCodeResponse = z.infer<typeof ticketCodeResponseSchema>;

export const verifyTicketBodySchema = z
  .object({ code: z.string({ message: 'Code obligatoire' }).trim().min(1).max(512) })
  .strict();
export type VerifyTicketBody = z.infer<typeof verifyTicketBodySchema>;

/** « valide », « déjà utilisé » ou « faux billet » côté contrôleur. */
export const verifyResultSchema = z.enum(['valid', 'already_used', 'invalid']);
export type VerifyResult = z.infer<typeof verifyResultSchema>;

export const verifiedTicketSchema = z.object({
  id: z.uuid(),
  seatNumber: z.number().int().positive(),
  passengerName: z.string(),
  usedAt: z.iso.datetime().nullable(),
  trip: bookingTripSchema,
});

export const verifyTicketResponseSchema = z.object({
  result: verifyResultSchema,
  /** Détails pour le contrôleur (nom, place, trajet) ; null pour un faux billet. */
  ticket: verifiedTicketSchema.nullable(),
});
export type VerifyTicketResponse = z.infer<typeof verifyTicketResponseSchema>;
