import { createServer } from 'node:http';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createLogger } from './lib/logger';

try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env (production) : les variables viennent de l'hébergeur.
}

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const app = createApp({ logger, corsOrigins: env.CORS_ORIGINS });
const server = createServer(app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API démarrée');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Arrêt en cours');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
