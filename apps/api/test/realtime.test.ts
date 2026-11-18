import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  SeatHeldEvent,
  SeatReleasedEvent,
  ServerToClientEvents,
} from '@billetterie/shared';
import { attachSockets, createSocketServer } from '../src/realtime/socket';
import { createSocketSeatEvents, type SocketServer } from '../src/realtime/seat-events';
import { createTrip, resetDb } from './db';
import { resetRedis } from './redis';
import { authAs, buildTestApp, sleep } from './helpers';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: Server;
let io: SocketServer;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  // Même montage qu'en production : Express et Socket.io sur le même serveur HTTP.
  io = createSocketServer(['http://localhost:5173']);
  httpServer = attachSockets(buildTestApp({ events: createSocketSeatEvents(io) }), io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await new Promise((resolve) => io.close(resolve));
});

beforeEach(async () => {
  await Promise.all([resetDb(), resetRedis()]);
});

async function client(transports: ('websocket' | 'polling')[] = ['websocket']): Promise<Client> {
  const socket: Client = connect(url, { transports, forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

const join = (socket: Client, tripId: string) =>
  new Promise<boolean>((resolve) => socket.emit('trip:join', tripId, resolve));
const leave = (socket: Client, tripId: string) =>
  new Promise<boolean>((resolve) => socket.emit('trip:leave', tripId, resolve));

function next<E extends keyof ServerToClientEvents>(socket: Client, event: E, timeoutMs = 2000) {
  return new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} non reçu`)), timeoutMs);
    socket.once(event, ((payload: Parameters<ServerToClientEvents[E]>[0]) => {
      clearTimeout(timer);
      resolve(payload);
    }) as never);
  });
}

describe('temps réel : deux visiteurs sur le même trajet', () => {
  it('B voit en moins d’une seconde la place que A bloque, puis libère', async () => {
    const trip = await createTrip();
    const a = await authAs();
    const [, b] = [await client(), await client()];
    expect(await join(b, trip.id)).toBe(true);

    const heldPromise = next(b, 'seat:held');
    const start = performance.now();
    const res = await request(httpServer)
      .post(`/api/v1/trips/${trip.id}/holds`)
      .set('Authorization', a.header)
      .send({ seatNumber: 4 })
      .expect(201);
    const held: SeatHeldEvent = await heldPromise;
    const latencyMs = performance.now() - start;

    expect(held).toEqual({ tripId: trip.id, seatNumber: 4, expiresAt: res.body.expiresAt });
    expect(latencyMs).toBeLessThan(1000);
    expect(JSON.stringify(held)).not.toContain(a.user.id);

    const releasedPromise = next(b, 'seat:released');
    await request(httpServer)
      .delete(`/api/v1/trips/${trip.id}/holds/4`)
      .set('Authorization', a.header)
      .expect(204);
    const released: SeatReleasedEvent = await releasedPromise;
    expect(released).toEqual({ tripId: trip.id, seatNumber: 4 });
  });

  it('un visiteur ne reçoit que les événements des trajets dont il est dans la salle', async () => {
    const trip = await createTrip();
    const otherTrip = await createTrip({ departureAt: new Date(Date.now() + 2 * 86_400_000) });
    const { header } = await authAs();
    const watcher = await client();
    await join(watcher, otherTrip.id);
    const received: unknown[] = [];
    watcher.on('seat:held', (e) => received.push(e));

    await request(httpServer)
      .post(`/api/v1/trips/${trip.id}/holds`)
      .set('Authorization', header)
      .send({ seatNumber: 1 })
      .expect(201);
    await sleep(300);

    expect(received).toEqual([]);
  });

  it('après trip:leave, plus aucun événement', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    const watcher = await client();
    await join(watcher, trip.id);
    expect(await leave(watcher, trip.id)).toBe(true);
    const received: unknown[] = [];
    watcher.on('seat:held', (e) => received.push(e));

    await request(httpServer)
      .post(`/api/v1/trips/${trip.id}/holds`)
      .set('Authorization', header)
      .send({ seatNumber: 2 })
      .expect(201);
    await sleep(300);

    expect(received).toEqual([]);
  });

  it('refuse de rejoindre ou quitter une salle avec un identifiant invalide', async () => {
    const socket = await client();

    expect(await join(socket, 'pas-un-uuid')).toBe(false);
    expect(await leave(socket, 'pas-un-uuid')).toBe(false);
  });

  it('fonctionne aussi sans accusé de réception', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    const socket = await client();
    socket.emit('trip:join', trip.id);
    await sleep(200);

    const heldPromise = next(socket, 'seat:held');
    await request(httpServer)
      .post(`/api/v1/trips/${trip.id}/holds`)
      .set('Authorization', header)
      .send({ seatNumber: 5 })
      .expect(201);

    expect((await heldPromise).seatNumber).toBe(5);
    socket.emit('trip:leave', trip.id);
  });
});

describe('montage Express + Socket.io sur un même port', () => {
  it('un navigateur (long polling HTTP d’abord) se connecte et reçoit les événements', async () => {
    const trip = await createTrip();
    const { header } = await authAs();
    const browserLike = await client(['polling']);
    expect(await join(browserLike, trip.id)).toBe(true);

    const heldPromise = next(browserLike, 'seat:held');
    await request(httpServer)
      .post(`/api/v1/trips/${trip.id}/holds`)
      .set('Authorization', header)
      .send({ seatNumber: 8 })
      .expect(201);

    expect((await heldPromise).seatNumber).toBe(8);
  });

  it('sert le client socket.io.js, et Express répond toujours à côté', async () => {
    const script = await request(httpServer).get('/socket.io/socket.io.js').expect(200);
    expect(script.headers['content-type']).toMatch(/javascript/);

    await request(httpServer).get('/api/v1/health').expect(200);
    await request(httpServer).get('/api/v1/inconnu').expect(404);
  });
});
