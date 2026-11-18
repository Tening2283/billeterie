import type { Logger } from 'pino';
import type { Redis } from '../lib/redis';
import type { SeatEvents } from '../realtime/seat-events';
import { EXPIRY_KEY, holdKey, parseHoldMember, withHoldScripts } from './hold-store';

export interface Sweeper {
  /** Un passage : libère (et annonce) les blocages expirés. Renvoie le nombre de places libérées. */
  sweep(now?: number): Promise<number>;
  /** Appelé toutes les `intervalMs` : ne fait un passage que si un blocage est dû (ou passage de sûreté). */
  tick(now?: number): Promise<void>;
  notifyHold(expiresAtMs: number): void;
  start(): void;
  stop(): void;
}

export interface SweeperDeps {
  redis: Redis;
  events: SeatEvents;
  logger: Logger;
  intervalMs?: number;
  /** Passage de sûreté même sans échéance connue (blocages posés par une autre instance, etc.). */
  safetySweepEveryMs?: number;
  batchSize?: number;
}

/**
 * Redis supprime les clés expirées mais ne prévient personne : le balayeur annonce `seat:released`.
 * Économe en commandes (quota Upstash) : il connaît la prochaine échéance et dort jusque-là.
 */
export function createSweeper({
  redis: baseRedis,
  events,
  logger,
  intervalMs = 5000,
  safetySweepEveryMs = 60_000,
  batchSize = 500,
}: SweeperDeps): Sweeper {
  const redis = withHoldScripts(baseRedis);
  let nextDueAt = 0; // 0 : premier passage au démarrage (blocages posés avant un redémarrage).
  let lastSweepAt = 0;
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  async function sweep(now = Date.now()): Promise<number> {
    // 1. Les blocages dont l'échéance est passée.
    const due = await redis.zrangebyscore(EXPIRY_KEY, 0, now, 'LIMIT', 0, batchSize);

    // 2 et 3. Libérer ceux dont la clé n'existe plus, retirer leur échéance (d'un bloc, voir SWEEP_LUA).
    const released =
      due.length === 0
        ? []
        : await redis.sweepHolds(
            due.length + 1,
            EXPIRY_KEY,
            // Format des clés défini à un seul endroit (hold-store) : pas de reconstruction à la main.
            ...due.map((member) => {
              const { tripId, seatNumber } = parseHoldMember(member);
              return holdKey(tripId, seatNumber);
            }),
            now,
            ...due,
          );
    for (const member of released) {
      const { tripId, seatNumber } = parseHoldMember(member);
      events.released(tripId, seatNumber);
    }

    // Prochaine échéance connue : rien à faire avant.
    const next = await redis.zrange(EXPIRY_KEY, 0, '0', 'WITHSCORES');
    nextDueAt = next[1] === undefined ? Number.POSITIVE_INFINITY : Number(next[1]);
    lastSweepAt = now;
    return released.length;
  }

  async function tick(now = Date.now()): Promise<void> {
    if (running) return;
    if (now < nextDueAt && now - lastSweepAt < safetySweepEveryMs) return;
    running = true;
    try {
      const released = await sweep(now);
      if (released > 0) logger.info({ released }, 'Blocages expirés libérés');
    } catch (err) {
      logger.error({ err }, 'Échec du balayage des blocages');
    } finally {
      running = false;
    }
  }

  return {
    sweep,
    tick,
    notifyHold(expiresAtMs) {
      nextDueAt = Math.min(nextDueAt, expiresAtMs);
    },
    start() {
      timer ??= setInterval(() => void tick(), intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
