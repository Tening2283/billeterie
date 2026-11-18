import { createServer, type Server as HttpServer } from 'node:http';
import type { Express } from 'express';
import { Server } from 'socket.io';
import { z } from 'zod';
import { tripRoom } from '@billetterie/shared';
import type { SocketServer } from './seat-events';

const tripId = z.uuid();

/**
 * Socket.io ne sert qu'à recevoir les changements d'état : un client entre dans la salle
 * d'un trajet (`trip:join`) et en sort (`trip:leave`). Les actions passent par l'API REST.
 * Créé sans serveur HTTP : voir `listenWithSockets` pour l'ordre de montage.
 */
export function createSocketServer(corsOrigins: string[]): SocketServer {
  const io: SocketServer = new Server({ cors: { origin: corsOrigins } });

  io.on('connection', (socket) => {
    socket.on('trip:join', async (id, ack) => {
      const ok = tripId.safeParse(id).success;
      if (ok) await socket.join(tripRoom(id));
      if (typeof ack === 'function') ack(ok);
    });
    socket.on('trip:leave', async (id, ack) => {
      const ok = tripId.safeParse(id).success;
      if (ok) await socket.leave(tripRoom(id));
      if (typeof ack === 'function') ack(ok);
    });
  });

  return io;
}

/**
 * Express et Socket.io sur le même serveur HTTP (un seul port, exigence de Render).
 * L'ordre compte : Express d'abord, Socket.io ensuite. En s'attachant, Socket.io garde les écouteurs
 * existants et ne leur transmet que les requêtes hors de /socket.io/. Dans l'ordre inverse, les deux
 * répondent aux requêtes /socket.io/ (long polling, socket.io.js) et la connexion casse.
 */
export function attachSockets(app: Express, io: SocketServer): HttpServer {
  const server = createServer(app);
  io.attach(server);
  return server;
}
