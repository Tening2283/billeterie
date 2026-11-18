import {
  HOLD_TTL_MS,
  MAX_HOLDS_PER_TRIP,
  MIN_REMAINING_HOLD_MS,
  type HoldResponse,
} from '@billetterie/shared';
import { z } from 'zod';
import { AppError } from '../lib/app-error';
import type { Db } from '../lib/db';
import type { Redis } from '../lib/redis';
import type { SeatEvents } from '../realtime/seat-events';
import { findBookableTrip } from './bookable-trip';
import { EXPIRY_KEY, holdKey, holdMember, withHoldScripts } from './hold-store';

const uuid = z.uuid();

export interface SeatHold {
  userId: string;
  /** null seulement dans un cas anormal (échéance absente de holds:expiry). */
  expiresAt: Date | null;
}

export interface HoldService {
  hold(userId: string, tripId: string, seatNumber: number): Promise<HoldResponse>;
  release(userId: string, tripId: string, seatNumber: number): Promise<void>;
  /** Blocages en cours sur un trajet : un seul aller-retour (MGET + ZMSCORE en pipeline). */
  seatHolds(tripId: string, seatCount: number): Promise<Map<number, SeatHold>>;
  /** 409 HOLD_EXPIRED si l'une des places n'est plus bloquée par cet utilisateur avec assez de marge. */
  assertHeldBy(userId: string, tripId: string, seatNumbers: number[]): Promise<void>;
  /** Après une vente validée en base : supprime les blocages, sans événement (la vente émet seat:sold). */
  releaseAfterSale(userId: string, tripId: string, seatNumbers: number[]): Promise<void>;
}

export interface HoldServiceDeps {
  db: Db;
  redis: Redis;
  events: SeatEvents;
  ttlMs?: number;
  maxPerTrip?: number;
  /** Prévient le balayeur qu'une échéance approche (il dort tant qu'aucun blocage n'est dû). */
  onHoldCreated?: (expiresAtMs: number) => void;
  now?: () => number;
}

const notYourHold = () =>
  new AppError(404, 'NOT_FOUND', 'Vous ne bloquez pas cette place (ou le blocage a expiré).');

export function createHoldService({
  db,
  redis: baseRedis,
  events,
  ttlMs = HOLD_TTL_MS,
  maxPerTrip = MAX_HOLDS_PER_TRIP,
  onHoldCreated = () => {},
  now = Date.now,
}: HoldServiceDeps): HoldService {
  const redis = withHoldScripts(baseRedis);

  return {
    async hold(userId, tripId, seatNumber) {
      // 1. Le trajet existe, la place existe dans ce car, le trajet est programmé et pas encore parti.
      const trip = await findBookableTrip(db, tripId, [seatNumber], now());

      // 2. Aucun billet actif pour cette place (la vente définitive est en base).
      const isSold = async () =>
        (await db.ticket.findFirst({
          where: { tripId, seatNumber, status: { not: 'cancelled' } },
          select: { id: true },
        })) !== null;
      if (await isSold()) throw new AppError(409, 'SEAT_TAKEN', "Cette place vient d'être prise.");

      // 3 à 5. Limite de 4 places + SET NX PX + ZADD, d'un bloc (voir HOLD_LUA).
      const seats = Array.from({ length: trip.bus.seatCount }, (_, i) => holdKey(tripId, i + 1));
      const expiresAtMs = now() + ttlMs;
      const [status, ttl] = await redis.holdSeat(
        seats.length + 1,
        ...seats,
        EXPIRY_KEY,
        userId,
        seatNumber,
        ttlMs,
        maxPerTrip,
        expiresAtMs,
        holdMember(tripId, seatNumber),
      );

      if (status === 0) throw new AppError(409, 'SEAT_TAKEN', "Cette place vient d'être prise.");
      if (status === -1) {
        throw new AppError(
          409,
          'HOLD_LIMIT',
          `Vous ne pouvez pas bloquer plus de ${maxPerTrip} places sur ce trajet.`,
          { max: maxPerTrip },
        );
      }

      const expiresAt = new Date(status === 2 ? now() + ttl : expiresAtMs);
      if (status === 1) {
        // Une vente a pu se terminer entre l'étape 2 et la pose du blocage : elle a alors libéré
        // l'ancien blocage et laissé la place libre dans Redis. On revérifie la base, qui fait foi :
        // si la place est vendue, on retire ce blocage avant que quiconque l'ait vu.
        if (await isSold()) {
          await redis.releaseSeat(
            2,
            holdKey(tripId, seatNumber),
            EXPIRY_KEY,
            userId,
            holdMember(tripId, seatNumber),
          );
          throw new AppError(409, 'SEAT_TAKEN', "Cette place vient d'être prise.");
        }
        // 6. Prévenir la salle du trajet.
        events.held(tripId, seatNumber, expiresAt);
        onHoldCreated(expiresAtMs);
      }
      return { tripId, seatNumber, expiresAt: expiresAt.toISOString() };
    },

    async release(userId, tripId, seatNumber) {
      if (!uuid.safeParse(tripId).success) throw notYourHold();
      const released = await redis.releaseSeat(
        2,
        holdKey(tripId, seatNumber),
        EXPIRY_KEY,
        userId,
        holdMember(tripId, seatNumber),
      );
      if (released !== 1) throw notYourHold();
      events.released(tripId, seatNumber);
    },

    async seatHolds(tripId, seatCount) {
      const numbers = Array.from({ length: seatCount }, (_, i) => i + 1);
      const results = await redis
        .pipeline()
        .mget(numbers.map((n) => holdKey(tripId, n)))
        .zmscore(
          EXPIRY_KEY,
          numbers.map((n) => holdMember(tripId, n)),
        )
        .exec();

      const [[ownersError, owners], [scoresError, scores]] = results as [
        [Error | null, (string | null)[]],
        [Error | null, (string | null)[]],
      ];
      if (ownersError) throw ownersError;
      if (scoresError) throw scoresError;

      const holds = new Map<number, SeatHold>();
      numbers.forEach((n, i) => {
        const userId = owners[i];
        if (!userId) return;
        const score = scores[i];
        holds.set(n, { userId, expiresAt: score ? new Date(Number(score)) : null });
      });
      return holds;
    },

    async assertHeldBy(userId, tripId, seatNumbers) {
      // GET (propriétaire) + PTTL (temps restant) de chaque place, en un seul aller-retour.
      const pipeline = redis.pipeline();
      for (const seat of seatNumbers) {
        pipeline.get(holdKey(tripId, seat)).pttl(holdKey(tripId, seat));
      }
      const results = (await pipeline.exec()) ?? [];

      const lost: number[] = [];
      seatNumbers.forEach((seat, i) => {
        const [ownerError, owner] = results[2 * i]!;
        const [ttlError, ttl] = results[2 * i + 1]!;
        if (ownerError ?? ttlError) throw ownerError ?? ttlError;
        if (owner !== userId || (ttl as number) <= MIN_REMAINING_HOLD_MS) lost.push(seat);
      });
      if (lost.length > 0) {
        throw new AppError(
          409,
          'HOLD_EXPIRED',
          'Le blocage de certaines places a expiré : choisissez-les à nouveau.',
          { seatNumbers: lost },
        );
      }
    },

    async releaseAfterSale(userId, tripId, seatNumbers) {
      // Même script que DELETE : si un blocage a expiré puis été repris par un autre, on n'y touche pas.
      await Promise.all(
        seatNumbers.map((seat) =>
          redis.releaseSeat(2, holdKey(tripId, seat), EXPIRY_KEY, userId, holdMember(tripId, seat)),
        ),
      );
    },
  };
}
