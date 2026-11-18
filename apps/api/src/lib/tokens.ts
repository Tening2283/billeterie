import { SignJWT, jwtVerify } from 'jose';
import { roleSchema, type Role } from '@billetterie/shared';

export interface AuthUser {
  id: string;
  role: Role;
}

export interface TokenService {
  sign(user: AuthUser): Promise<{ token: string; expiresAt: Date }>;
  /** Lève une erreur si le jeton est invalide, falsifié ou expiré. */
  verify(token: string): Promise<AuthUser>;
}

const ISSUER = 'billetterie-api';
const AUDIENCE = 'billetterie-web';

/** Jetons JWT HS256 de courte durée (1 h par défaut) : voir la section Sécurité du cahier des charges. */
export function createTokenService(
  secret: string,
  { ttlSeconds = 3600, now = () => new Date() } = {},
): TokenService {
  const key = new TextEncoder().encode(secret);

  return {
    async sign(user) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = new Date((issuedAt + ttlSeconds) * 1000);
      const token = await new SignJWT({ role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(key);
      return { token, expiresAt };
    },

    async verify(token) {
      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: now(),
      });
      if (!payload.sub) throw new Error('Jeton sans sujet');
      return { id: payload.sub, role: roleSchema.parse(payload.role) };
    },
  };
}
