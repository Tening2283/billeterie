import type { Server } from 'socket.io';
import {
  tripRoom,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@billetterie/shared';

export type SocketServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Prévient les visiteurs d'un trajet qu'une place a changé d'état. Jamais d'identité d'utilisateur. */
export interface SeatEvents {
  held(tripId: string, seatNumber: number, expiresAt: Date): void;
  released(tripId: string, seatNumber: number): void;
  sold(tripId: string, seatNumbers: number[]): void;
}

export function createSocketSeatEvents(io: SocketServer): SeatEvents {
  return {
    held: (tripId, seatNumber, expiresAt) =>
      io
        .to(tripRoom(tripId))
        .emit('seat:held', { tripId, seatNumber, expiresAt: expiresAt.toISOString() }),
    released: (tripId, seatNumber) =>
      io.to(tripRoom(tripId)).emit('seat:released', { tripId, seatNumber }),
    sold: (tripId, seatNumbers) =>
      io.to(tripRoom(tripId)).emit('seat:sold', { tripId, seatNumbers }),
  };
}

export const noopSeatEvents: SeatEvents = {
  held: () => {},
  released: () => {},
  sold: () => {},
};
