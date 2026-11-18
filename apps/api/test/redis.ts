import { afterAll, beforeAll } from 'vitest';
import { createRedis } from '../src/lib/redis';
import { warmUp } from './warm-up';

export const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX ?? '';

/** Client des tests : mêmes clés préfixées que l'appli. */
export const testRedis = createRedis(process.env.REDIS_URL!, REDIS_PREFIX);
/** Client sans préfixe : vérifie que le préfixe est bien appliqué, et nettoie. */
export const rawRedis = createRedis(process.env.REDIS_URL!);

beforeAll(() => warmUp('Redis', () => Promise.all([testRedis.ping(), rawRedis.ping()])), 60_000);

afterAll(async () => {
  await Promise.all([testRedis.quit(), rawRedis.quit()]);
});

/** Supprime toutes les clés de test (préfixe `test:`), sans toucher à celles du dev. */
export async function resetRedis(): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await rawRedis.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 500);
    if (keys.length) await rawRedis.unlink(...keys);
    cursor = next;
  } while (cursor !== '0');
}
