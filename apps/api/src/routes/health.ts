import { Router } from 'express';
import type { HealthResponse } from '@billetterie/shared';

/** Une vérification lève une erreur (ou rejette) si le service ne répond pas. */
export type HealthCheck = () => Promise<unknown>;

export function healthRouter(checks: Record<string, HealthCheck>, timeoutMs: number): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, check]) => {
        try {
          await withTimeout(check(), timeoutMs);
          return [name, 'up'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );

    const body: HealthResponse = {
      status: entries.every(([, state]) => state === 'up') ? 'ok' : 'degraded',
      checks: Object.fromEntries(entries),
    };
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
