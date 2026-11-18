import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  TICKET_SECRET: 'y'.repeat(32),
  REDIS_URL: 'rediss://default:p@x.upstash.io:6379',
};

describe('loadEnv', () => {
  it('applique les valeurs par défaut', () => {
    expect(loadEnv(base)).toEqual({
      ...base,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173'],
      BCRYPT_COST: 12,
      REDIS_KEY_PREFIX: '',
      HOLD_TTL_MS: 600_000,
      DISABLE_RATE_LIMITS: false,
    });
  });

  it('les limitations de débit ne peuvent être levées que hors production (test de charge)', () => {
    expect(loadEnv({ ...base, DISABLE_RATE_LIMITS: 'true' }).DISABLE_RATE_LIMITS).toBe(true);
    expect(() => loadEnv({ ...base, DISABLE_RATE_LIMITS: 'oui' })).toThrow(/DISABLE_RATE_LIMITS/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', DISABLE_RATE_LIMITS: 'true' })).toThrow(
      /DISABLE_RATE_LIMITS: interdit en production/,
    );
  });

  it('exige une URL Redis (redis:// ou rediss://), pas l’URL REST d’Upstash', () => {
    expect(() => loadEnv({ ...base, REDIS_URL: undefined })).toThrow(/REDIS_URL: obligatoire/);
    expect(() => loadEnv({ ...base, REDIS_URL: 'https://x.upstash.io' })).toThrow(/rediss:\/\//);
  });

  it('découpe la liste des origines CORS', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'https://a.vercel.app, https://b.vercel.app,' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.vercel.app', 'https://b.vercel.app']);
  });

  it('refuse une valeur invalide avec un message clair', () => {
    expect(() => loadEnv({ ...base, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadEnv({ ...base, BCRYPT_COST: '3' })).toThrow(/BCRYPT_COST/);
  });

  it('exige une URL PostgreSQL', () => {
    expect(() => loadEnv({ JWT_SECRET: base.JWT_SECRET })).toThrow(/DATABASE_URL: obligatoire/);
    expect(() => loadEnv({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('exige un secret JWT d’au moins 32 caractères', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, JWT_SECRET: 'trop-court' })).toThrow(/32 caractères/);
  });

  it('exige un secret de billets distinct du secret JWT', () => {
    expect(() => loadEnv({ ...base, TICKET_SECRET: undefined })).toThrow(/TICKET_SECRET/);
    expect(() => loadEnv({ ...base, TICKET_SECRET: base.JWT_SECRET })).toThrow(
      /TICKET_SECRET: doit être différent de JWT_SECRET/,
    );
  });

  it('refuse une durée de blocage inférieure à la marge de confirmation (5 s)', () => {
    expect(() => loadEnv({ ...base, HOLD_TTL_MS: '5000' })).toThrow(
      /HOLD_TTL_MS: doit dépasser 5000/,
    );
    expect(loadEnv({ ...base, HOLD_TTL_MS: '5001' }).HOLD_TTL_MS).toBe(5001);
  });
});
