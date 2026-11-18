import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@billetterie/shared';
import { API_ORIGIN } from './config';

export type TripSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TripSocket | undefined;

/**
 * Une seule connexion Socket.io pour tout l'onglet, ouverte à la première page qui en a besoin.
 * Socket.io se reconnecte seul après une coupure (réseau mobile, serveur qui redémarre).
 */
export function getSocket(): TripSocket {
  socket ??= API_ORIGIN ? io(API_ORIGIN) : io();
  return socket;
}
