import { Redis } from 'ioredis';

export type { Redis };

/**
 * Client Redis (Upstash en production : `rediss://`, TLS).
 * `keyPrefix` isole les environnements qui partagent une même base (dev:, test:, prod:) ;
 * ioredis l'ajoute aussi aux KEYS des scripts Lua, mais pas aux membres des ensembles triés.
 */
export function createRedis(url: string, keyPrefix = ''): Redis {
  return new Redis(url, {
    keyPrefix,
    // Échouer vite plutôt que de laisser une requête HTTP pendre si Redis ne répond plus.
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
  });
}
