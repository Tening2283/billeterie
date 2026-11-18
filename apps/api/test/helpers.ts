import type { SeatEvents } from '../src/realtime/seat-events';
import { createApp, type AppDeps } from '../src/app';
import { createLogger } from '../src/lib/logger';
import { createTokenService } from '../src/lib/tokens';
import { createTicketSigner } from '../src/lib/ticket-codes';
import { createUser, testDb } from './db';
import { testRedis } from './redis';

export const silentLogger = createLogger('silent');
export const TEST_JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-de-plus-de-32-caracteres-0000';
export const testTokens = createTokenService(TEST_JWT_SECRET);
export const TEST_TICKET_SECRET =
  process.env.TICKET_SECRET ?? 'test-secret-billets-de-plus-de-32-caracteres';
export const testSigner = createTicketSigner(TEST_TICKET_SECRET);

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    logger: silentLogger,
    corsOrigins: ['http://localhost:5173'],
    db: testDb,
    redis: testRedis,
    jwtSecret: TEST_JWT_SECRET,
    ticketSecret: TEST_TICKET_SECRET,
    bcryptCost: 4,
    // Limites très hautes par défaut : seuls les tests dédiés vérifient la limitation de débit.
    rateLimits: { register: 1000, login: 1000, demo: 1000, holds: 1000 },
    ...overrides,
  });
}

/** Crée un utilisateur en base et renvoie l'en-tête Authorization correspondant. */
export async function authAs(role: 'traveler' | 'controller' | 'admin' = 'traveler') {
  const user = await createUser(role);
  const { token } = await testTokens.sign({ id: user.id, role });
  return { user, header: `Bearer ${token}` };
}

export type RecordedEvent =
  | { type: 'held'; tripId: string; seatNumber: number; expiresAt: string }
  | { type: 'released'; tripId: string; seatNumber: number }
  | { type: 'sold'; tripId: string; seatNumbers: number[] };

/** Faux émetteur d'événements qui garde tout en mémoire. */
export function recordingEvents(): SeatEvents & { log: RecordedEvent[] } {
  const log: RecordedEvent[] = [];
  return {
    log,
    held: (tripId, seatNumber, expiresAt) =>
      log.push({ type: 'held', tripId, seatNumber, expiresAt: expiresAt.toISOString() }),
    released: (tripId, seatNumber) => log.push({ type: 'released', tripId, seatNumber }),
    sold: (tripId, seatNumbers) => log.push({ type: 'sold', tripId, seatNumbers }),
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
