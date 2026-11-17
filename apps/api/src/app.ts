import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { healthRouter, type HealthCheck } from './routes/health';
import { errorHandler, notFoundHandler } from './middleware/errors';

export interface AppDeps {
  logger: Logger;
  corsOrigins: string[];
  /** PostgreSQL et Redis s'y ajouteront aux étapes 1 et 3. */
  healthChecks?: Record<string, HealthCheck>;
  healthTimeoutMs?: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Render place l'API derrière un proxy : sans ça, tous les visiteurs auraient la même IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigins }));
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

  const api = express.Router();
  api.use(healthRouter(deps.healthChecks ?? {}, deps.healthTimeoutMs ?? 2000));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
