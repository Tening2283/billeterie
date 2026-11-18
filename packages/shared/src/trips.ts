import { z } from 'zod';
import { busLayoutSchema } from './bus';

const city = z.string().trim().min(1, 'Ville obligatoire').max(60);

/** `GET /trips?from=Dakar&to=Thiès&date=2026-11-20` : date du jour de départ, en heure de Dakar (UTC+0). */
export const searchTripsQuerySchema = z
  .object({
    from: city,
    to: city,
    date: z.iso.date({ message: 'Date attendue au format AAAA-MM-JJ' }),
  })
  .strict();
export type SearchTripsQuery = z.infer<typeof searchTripsQuerySchema>;

export const tripSummarySchema = z.object({
  id: z.uuid(),
  origin: z.string(),
  destination: z.string(),
  departureAt: z.iso.datetime(),
  priceFcfa: z.number().int().nonnegative(),
  busName: z.string(),
  seatCount: z.number().int().positive(),
  remainingSeats: z.number().int().nonnegative(),
});
export type TripSummary = z.infer<typeof tripSummarySchema>;

export const searchTripsResponseSchema = z.object({ trips: z.array(tripSummarySchema) });
export type SearchTripsResponse = z.infer<typeof searchTripsResponseSchema>;

export const tripStatusSchema = z.enum(['scheduled', 'cancelled']);

export const tripDetailSchema = tripSummarySchema.extend({
  status: tripStatusSchema,
  layout: busLayoutSchema,
});
export type TripDetail = z.infer<typeof tripDetailSchema>;

export const seatStateSchema = z.enum(['free', 'held', 'sold']);
export type SeatState = z.infer<typeof seatStateSchema>;

export const seatStatusSchema = z.object({
  seatNumber: z.number().int().positive(),
  state: seatStateSchema,
  /** Vrai si la place est bloquée par l'utilisateur connecté. */
  heldByMe: z.boolean(),
  /** Fin du blocage (ISO), null si la place n'est pas bloquée. */
  expiresAt: z.iso.datetime().nullable(),
});
export type SeatStatus = z.infer<typeof seatStatusSchema>;

export const tripSeatsResponseSchema = z.object({
  tripId: z.uuid(),
  seats: z.array(seatStatusSchema),
});
export type TripSeatsResponse = z.infer<typeof tripSeatsResponseSchema>;
