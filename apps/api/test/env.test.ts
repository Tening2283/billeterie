import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('applique les valeurs par défaut', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      CORS_ORIGINS: ['http://localhost:5173'],
    });
  });

  it('découpe la liste des origines CORS', () => {
    const env = loadEnv({ CORS_ORIGINS: 'https://a.vercel.app, https://b.vercel.app,' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.vercel.app', 'https://b.vercel.app']);
  });

  it('refuse une valeur invalide avec un message clair', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
