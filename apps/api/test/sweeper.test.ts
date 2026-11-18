import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Redis } from '../src/lib/redis';
import { createSweeper } from '../src/services/sweeper';
import { EXPIRY_KEY, holdMember } from '../src/services/hold-store';
import { createTrip, resetDb } from './db';
import { resetRedis, testRedis } from './redis';
import { authAs, buildTestApp, recordingEvents, silentLogger, sleep } from './helpers';

// Cahier des charges : durée de blocage configurable, 200 ms en test.
const SHORT_TTL = 200;

beforeEach(async () => {
  await Promise.all([resetDb(), resetRedis()]);
});

const hold = (app: Express, tripId: string, seatNumber: number, header: string) =>
  request(app)
    .post(`/api/v1/trips/${tripId}/holds`)
    .set('Authorization', header)
    .send({ seatNumber })
    .expect(201);

function setup() {
  const events = recordingEvents();
  const sweeper = createSweeper({ redis: testRedis, events, logger: silentLogger });
  const shortApp = buildTestApp({ holdTtlMs: SHORT_TTL });
  const longApp = buildTestApp({ holdTtlMs: 60_000 });
  return { events, sweeper, shortApp, longApp };
}

describe('balayeur des blocages expirés', () => {
  it('annonce seat:released quand un blocage expire, et retire son échéance', async () => {
    const { events, sweeper, shortApp } = setup();
    const trip = await createTrip();
    await hold(shortApp, trip.id, 3, (await authAs()).header);
    await sleep(SHORT_TTL + 150);

    expect(await sweeper.sweep()).toBe(1);

    expect(events.log).toEqual([{ type: 'released', tripId: trip.id, seatNumber: 3 }]);
    expect(await testRedis.zcard(EXPIRY_KEY)).toBe(0);
    const seats = await request(shortApp).get(`/api/v1/trips/${trip.id}/seats`).expect(200);
    expect(seats.body.seats[2].state).toBe('free');
  });

  it('ne touche pas à un blocage encore valide', async () => {
    const { events, sweeper, longApp } = setup();
    const trip = await createTrip();
    await hold(longApp, trip.id, 3, (await authAs()).header);

    expect(await sweeper.sweep()).toBe(0);
    expect(events.log).toEqual([]);
    expect(await testRedis.zcard(EXPIRY_KEY)).toBe(1);
  });

  it('ne libère pas une place rebloquée entre l’expiration et le passage du balayeur', async () => {
    const { events, sweeper, shortApp, longApp } = setup();
    const trip = await createTrip();
    await hold(shortApp, trip.id, 3, (await authAs()).header);
    await sleep(SHORT_TTL + 150); // le blocage de A a expiré, le balayeur n'est pas passé
    const b = await authAs();
    await hold(longApp, trip.id, 3, b.header); // B la reprend : nouvelle échéance

    expect(await sweeper.sweep()).toBe(0);
    expect(events.log).toEqual([]);
    const seats = await request(longApp)
      .get(`/api/v1/trips/${trip.id}/seats`)
      .set('Authorization', b.header);
    expect(seats.body.seats[2]).toMatchObject({ state: 'held', heldByMe: true });
  });

  it('deux balayeurs simultanés (deux instances) n’annoncent chaque place qu’une fois', async () => {
    const { events, shortApp } = setup();
    const sweeperB = createSweeper({ redis: testRedis, events, logger: silentLogger });
    const sweeperA = createSweeper({ redis: testRedis, events, logger: silentLogger });
    const trip = await createTrip();
    const { header } = await authAs();
    await Promise.all([1, 2, 3].map((seat) => hold(shortApp, trip.id, seat, header)));
    await sleep(SHORT_TTL + 150);

    const [a, b] = await Promise.all([sweeperA.sweep(), sweeperB.sweep()]);

    expect(a + b).toBe(3);
    expect(events.log.map((e) => (e.type === 'released' ? e.seatNumber : 0)).sort()).toEqual([
      1, 2, 3,
    ]);
  });
});

describe('économie de commandes (quota Upstash)', () => {
  it('dort tant qu’aucune échéance n’est due, sauf passage de sûreté', async () => {
    const events = recordingEvents();
    const sweeper = createSweeper({
      redis: testRedis,
      events,
      logger: silentLogger,
      safetySweepEveryMs: 60_000,
    });
    const now = Date.now();
    await sweeper.tick(now); // premier passage : ensemble vide, plus rien de dû

    // Échéance passée posée « par une autre instance » : ce balayeur ne la connaît pas encore.
    const tripId = '00000000-0000-4000-8000-000000000001';
    await testRedis.zadd(EXPIRY_KEY, now - 1, holdMember(tripId, 9));

    await sweeper.tick(now + 1000);
    expect(events.log).toEqual([]); // il dort : 0 commande Redis

    await sweeper.tick(now + 61_000); // passage de sûreté
    expect(events.log).toEqual([{ type: 'released', tripId, seatNumber: 9 }]);
  });

  it('se réveille dès qu’on lui signale une échéance', async () => {
    const events = recordingEvents();
    const sweeper = createSweeper({ redis: testRedis, events, logger: silentLogger });
    const now = Date.now();
    await sweeper.tick(now);
    const tripId = '00000000-0000-4000-8000-000000000002';
    await testRedis.zadd(EXPIRY_KEY, now - 1, holdMember(tripId, 4));

    sweeper.notifyHold(now - 1);
    await sweeper.tick(now + 1000);

    expect(events.log).toEqual([{ type: 'released', tripId, seatNumber: 4 }]);
  });

  it('start() balaye à intervalle régulier, stop() arrête', async () => {
    const events = recordingEvents();
    const sweeper = createSweeper({
      redis: testRedis,
      events,
      logger: silentLogger,
      intervalMs: 20,
    });
    const tripId = '00000000-0000-4000-8000-000000000003';
    await testRedis.zadd(EXPIRY_KEY, Date.now() - 1, holdMember(tripId, 1));

    sweeper.start();
    sweeper.start(); // sans effet : un seul minuteur
    await vi.waitFor(() => expect(events.log).toHaveLength(1), { timeout: 3000 });
    sweeper.stop();

    expect(events.log[0]).toEqual({ type: 'released', tripId, seatNumber: 1 });
  });

  it('journalise une erreur Redis sans faire tomber l’API', async () => {
    const error = vi.fn();
    const brokenRedis = {
      defineCommand: () => {},
      zrangebyscore: () => Promise.reject(new Error('Redis injoignable')),
    } as unknown as Redis;
    const sweeper = createSweeper({
      redis: brokenRedis,
      events: recordingEvents(),
      logger: { ...silentLogger, error, info: () => {} } as unknown as typeof silentLogger,
    });

    await expect(sweeper.tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});
