import {
  authResponseSchema,
  bookingSchema,
  holdResponseSchema,
  myBookingsResponseSchema,
  searchTripsResponseSchema,
  ticketCodeResponseSchema,
  tripDetailSchema,
  tripSeatsResponseSchema,
  verifyTicketResponseSchema,
  type CreateBookingBody,
  type DemoLoginInput,
  type LoginInput,
  type RegisterInput,
  type SearchTripsQuery,
} from '@billetterie/shared';
import { apiRequest } from './api';

const id = (value: string) => encodeURIComponent(value);

/** Une fonction par route de l'API. */
export const api = {
  register: (body: RegisterInput) =>
    apiRequest('/auth/register', authResponseSchema, { method: 'POST', body }),
  login: (body: LoginInput) =>
    apiRequest('/auth/login', authResponseSchema, { method: 'POST', body }),
  demo: (body: DemoLoginInput) =>
    apiRequest('/auth/demo', authResponseSchema, { method: 'POST', body }),

  searchTrips: (query: SearchTripsQuery) =>
    apiRequest(`/trips?${new URLSearchParams(query)}`, searchTripsResponseSchema),
  trip: (tripId: string) => apiRequest(`/trips/${id(tripId)}`, tripDetailSchema),
  seats: (tripId: string) => apiRequest(`/trips/${id(tripId)}/seats`, tripSeatsResponseSchema),

  hold: (tripId: string, seatNumber: number) =>
    apiRequest(`/trips/${id(tripId)}/holds`, holdResponseSchema, {
      method: 'POST',
      body: { seatNumber },
    }),
  release: (tripId: string, seatNumber: number) =>
    apiRequest(`/trips/${id(tripId)}/holds/${seatNumber}`, null, { method: 'DELETE' }),

  createBooking: (idempotencyKey: string, body: CreateBookingBody) =>
    apiRequest('/bookings', bookingSchema, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  myBookings: () => apiRequest('/bookings/me', myBookingsResponseSchema),
  ticketCode: (ticketId: string) =>
    apiRequest(`/tickets/${id(ticketId)}/code`, ticketCodeResponseSchema),
  verifyTicket: (code: string) =>
    apiRequest('/tickets/verify', verifyTicketResponseSchema, { method: 'POST', body: { code } }),
};

/** Clés du cache TanStack Query. Les places dépendent du visiteur (heldByMe). */
export const queryKeys = {
  trips: (query: SearchTripsQuery) => ['trips', query] as const,
  trip: (tripId: string) => ['trip', tripId] as const,
  /** Préfixe : toutes les versions (visiteur, voyageur…) des places d'un trajet. */
  seatsOfTrip: (tripId: string) => ['seats', tripId] as const,
  seats: (tripId: string, userId: string | undefined) =>
    ['seats', tripId, userId ?? 'visiteur'] as const,
  bookings: ['bookings'] as const,
  ticketCodes: ['ticket-code'] as const,
  ticketCode: (ticketId: string) => ['ticket-code', ticketId] as const,
};
