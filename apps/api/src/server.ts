import { createApp } from './app';
import { loadEnv } from './config/env';
import { loadEnvFile } from './config/load-env-file';
import { createDb } from './lib/db';
import { createLogger } from './lib/logger';
import { createRedis } from './lib/redis';
import { attachSockets, createSocketServer } from './realtime/socket';
import { createSocketSeatEvents } from './realtime/seat-events';
import { createSweeper } from './services/sweeper';
import { ensureUpcomingTrips } from './demo/ensure-upcoming-trips';
import { seedDemoCatalog } from './demo/seed-catalog';

// En local : lit apps/api/.env. En production : les variables viennent de l'hébergeur.
loadEnvFile('.env');

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL, env.REDIS_KEY_PREFIX);
redis.on('error', (err) => logger.error({ err }, 'Erreur Redis'));

const io = createSocketServer(env.CORS_ORIGINS);
const events = createSocketSeatEvents(io);
const sweeper = createSweeper({ redis, events, logger });

const app = createApp({
  logger,
  corsOrigins: env.CORS_ORIGINS,
  db,
  redis,
  events,
  jwtSecret: env.JWT_SECRET,
  ticketSecret: env.TICKET_SECRET,
  bcryptCost: env.BCRYPT_COST,
  holdTtlMs: env.HOLD_TTL_MS,
  onHoldCreated: (expiresAtMs) => sweeper.notifyHold(expiresAtMs),
  // Activation explicite (NODE_ENV=development écrit dans .env) : loadEnv met « development » par
  // défaut, donc un déploiement qui oublierait NODE_ENV exposerait /dev/ si on se fiait à env.NODE_ENV.
  devPage: process.env.NODE_ENV === 'development',
});
// Express et Socket.io partagent le même serveur HTTP, donc le même port.
const server = attachSockets(app, io);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API démarrée');
  sweeper.start();
});

/**
 * La démo doit toujours proposer des départs à venir, même après des semaines sans redéploiement :
 * catalogue (cars, lignes, comptes de démo) puis départs des 14 prochains jours. Idempotent.
 * Au démarrage (une base de production neuve n'a pas besoin de seed manuel), puis toutes les 6 h.
 */
async function prepareDemoData(): Promise<void> {
  try {
    await seedDemoCatalog(db, { bcryptCost: env.BCRYPT_COST });
    const created = await ensureUpcomingTrips(db);
    logger.info({ created }, 'Données de démo vérifiées');
  } catch (err) {
    logger.error({ err }, 'Impossible de préparer les données de démo');
  }
}
void prepareDemoData();
const demoDataTimer = setInterval(() => void prepareDemoData(), 6 * 3_600_000);
demoDataTimer.unref();

function shutdown(signal: string): void {
  logger.info({ signal }, 'Arrêt en cours');
  clearInterval(demoDataTimer);
  sweeper.stop();
  void io.close(() => {
    void Promise.allSettled([db.$disconnect(), redis.quit()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
