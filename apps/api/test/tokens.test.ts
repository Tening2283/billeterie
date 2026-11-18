import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { createTokenService } from '../src/lib/tokens';

const SECRET = 'secret-de-test-de-plus-de-32-caracteres-abc';
const user = { id: '11111111-1111-4111-8111-111111111111', role: 'traveler' as const };

describe('createTokenService', () => {
  it('signe puis vérifie un jeton valide 1 h', async () => {
    const now = new Date('2030-01-01T10:00:00Z');
    const tokens = createTokenService(SECRET, { now: () => now });

    const { token, expiresAt } = await tokens.sign(user);

    expect(expiresAt.toISOString()).toBe('2030-01-01T11:00:00.000Z');
    await expect(tokens.verify(token)).resolves.toEqual(user);
  });

  it('refuse un jeton expiré', async () => {
    let now = new Date('2030-01-01T10:00:00Z');
    const tokens = createTokenService(SECRET, { now: () => now });
    const { token } = await tokens.sign(user);

    now = new Date('2030-01-01T11:00:01Z');

    await expect(tokens.verify(token)).rejects.toThrow();
  });

  it('refuse un jeton modifié (rôle changé à la main)', async () => {
    const tokens = createTokenService(SECRET);
    const { token } = await tokens.sign(user);
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(JSON.stringify({ sub: user.id, role: 'admin' })).toString(
      'base64url',
    );

    await expect(tokens.verify(`${header}.${payload}.${signature}`)).rejects.toThrow();
  });

  it('refuse un jeton sans sujet ou avec un rôle inconnu', async () => {
    const key = new TextEncoder().encode(SECRET);
    const sign = (claims: Record<string, unknown>, sub?: string) => {
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('billetterie-api')
        .setAudience('billetterie-web')
        .setExpirationTime('1h');
      return (sub ? jwt.setSubject(sub) : jwt).sign(key);
    };
    const tokens = createTokenService(SECRET);

    await expect(tokens.verify(await sign({ role: 'traveler' }))).rejects.toThrow(/sujet/);
    await expect(tokens.verify(await sign({ role: 'pirate' }, user.id))).rejects.toThrow();
  });
});
