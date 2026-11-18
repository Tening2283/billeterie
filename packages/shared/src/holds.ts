import { z } from 'zod';

/** Durée d'un blocage de place : 10 minutes. */
export const HOLD_TTL_MS = 10 * 60_000;
/** Marge exigée à la confirmation : un blocage qui expire dans moins de 5 s ne permet pas d'acheter. */
export const MIN_REMAINING_HOLD_MS = 5000;
/** Places bloquées au plus par voyageur et par trajet. */
export const MAX_HOLDS_PER_TRIP = 4;

export const createHoldBodySchema = z.object({ seatNumber: z.number().int().positive() }).strict();
export type CreateHoldBody = z.infer<typeof createHoldBodySchema>;

export const holdResponseSchema = z.object({
  tripId: z.uuid(),
  seatNumber: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export type HoldResponse = z.infer<typeof holdResponseSchema>;

/**
 * Événements Socket.io. Ils préviennent seulement qu'un état a changé :
 * toutes les actions passent par l'API REST, et aucun événement ne contient l'identité d'un utilisateur.
 */
export interface SeatHeldEvent {
  tripId: string;
  seatNumber: number;
  expiresAt: string;
}
export interface SeatReleasedEvent {
  tripId: string;
  seatNumber: number;
}
export interface SeatSoldEvent {
  tripId: string;
  seatNumbers: number[];
}

export interface ServerToClientEvents {
  'seat:held': (event: SeatHeldEvent) => void;
  'seat:released': (event: SeatReleasedEvent) => void;
  'seat:sold': (event: SeatSoldEvent) => void;
}

/** Accusé de réception optionnel : true si la salle a bien été rejointe (ou quittée). */
export type RoomAck = (ok: boolean) => void;

export interface ClientToServerEvents {
  'trip:join': (tripId: string, ack?: RoomAck) => void;
  'trip:leave': (tripId: string, ack?: RoomAck) => void;
}

/** Nom de la salle Socket.io d'un trajet. */
export const tripRoom = (tripId: string) => `trip:${tripId}`;
