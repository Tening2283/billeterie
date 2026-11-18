import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Db } from './lib/db';
import type { Redis } from './lib/redis';
import { createTokenService } from './lib/tokens';
import { createAuthService } from './services/auth';
import { createHoldService } from './services/holds';
import { createBookingService } from './services/bookings';
import { createTicketService } from './services/tickets';
import { createTicketSigner } from './lib/ticket-codes';
import { createAuthMiddleware, currentUser } from './middleware/auth';
import { createRateLimiter } from './middleware/rate-limit';
import { healthRouter, type HealthCheck } from './routes/health';
import { tripsRouter } from './routes/trips';
import { authRouter } from './routes/auth';
import { holdsRouter } from './routes/holds';
import { bookingsRouter } from './routes/bookings';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { noopSeatEvents, type SeatEvents } from './realtime/seat-events';

export interface RateLimits {
  /** Requêtes par minute et par IP. */
  register: number;
  login: number;
  demo: number;
  /** Requêtes par minute et par utilisateur (POST et DELETE de blocages). */
  holds: number;
}

/** Cahier des charges : connexion 5/min par IP, blocages 30/min par utilisateur. */
export const DEFAULT_RATE_LIMITS: RateLimits = { register: 5, login: 5, demo: 10, holds: 30 };

export interface AppDeps {
  logger: Logger;
  corsOrigins: string[];
  db: Db;
  redis: Redis;
  jwtSecret: string;
  /** Secret HMAC des codes de billets (différent par environnement, jamais celui des JWT). */
  ticketSecret: string;
  /** Socket.io en production ; rien par défaut (tests qui n'écoutent pas les événements). */
  events?: SeatEvents;
  holdTtlMs?: number;
  onHoldCreated?: (expiresAtMs: number) => void;
  tokenTtlSeconds?: number;
  bcryptCost?: number;
  rateLimits?: Partial<RateLimits>;
  /** Sert /dev/ : page HTML minimale pour voir les places changer entre deux onglets (jamais en prod). */
  devPage?: boolean;
  /** Par défaut : PostgreSQL et Redis. Remplaçable dans les tests. */
  healthChecks?: Record<string, HealthCheck>;
  healthTimeoutMs?: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Render place l'API derrière un proxy : sans ça, tous les visiteurs auraient la même IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: deps.corsOrigins,
      // Le front est sur un autre domaine : sans ça, il ne peut pas lire ces en-têtes de réponse.
      exposedHeaders: [
        'Idempotent-Replayed',
        'X-Request-Id',
        'RateLimit',
        'RateLimit-Policy',
        'Retry-After',
      ],
    }),
  );
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  const tokens = createTokenService(deps.jwtSecret, { ttlSeconds: deps.tokenTtlSeconds });
  const { requireAuth, requireRole, optionalAuth } = createAuthMiddleware(tokens);
  const auth = createAuthService(deps.db, tokens, { bcryptCost: deps.bcryptCost });
  const holds = createHoldService({
    db: deps.db,
    redis: deps.redis,
    events: deps.events ?? noopSeatEvents,
    ttlMs: deps.holdTtlMs,
    onHoldCreated: deps.onHoldCreated,
  });
  const bookings = createBookingService({
    db: deps.db,
    holds,
    events: deps.events ?? noopSeatEvents,
    logger: deps.logger,
  });
  const tickets = createTicketService({
    db: deps.db,
    signer: createTicketSigner(deps.ticketSecret),
  });
  const limits = { ...DEFAULT_RATE_LIMITS, ...deps.rateLimits };

  const healthChecks = deps.healthChecks ?? {
    postgres: () => deps.db.$queryRaw`SELECT 1`,
    redis: () => deps.redis.ping(),
  };

  const api = express.Router();
  api.use(healthRouter(healthChecks, deps.healthTimeoutMs ?? 2000));
  api.use(
    authRouter({
      auth,
      requireAuth,
      limiters: {
        register: createRateLimiter({ limit: limits.register }),
        login: createRateLimiter({ limit: limits.login }),
        demo: createRateLimiter({ limit: limits.demo }),
      },
    }),
  );
  api.use(tripsRouter({ db: deps.db, holds, optionalAuth }));
  api.use(bookingsRouter({ bookings, tickets, requireAuth, requireRole }));
  api.use(
    holdsRouter({
      holds,
      guards: [
        requireRole('traveler'),
        createRateLimiter({ limit: limits.holds, keyGenerator: (req) => currentUser(req).id }),
      ],
    }),
  );
  app.use('/api/v1', api);

  if (deps.devPage) {
    app.use('/dev', express.static(fileURLToPath(new URL('../public/dev', import.meta.url))));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
