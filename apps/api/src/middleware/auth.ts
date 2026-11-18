import type { Request, RequestHandler } from 'express';
import type { Role } from '@billetterie/shared';
import { AppError } from '../lib/app-error';
import type { AuthUser, TokenService } from '../lib/tokens';

const unauthenticated = () =>
  new AppError(
    401,
    'UNAUTHENTICATED',
    'Connectez-vous pour continuer (session absente ou expirée).',
  );

export function createAuthMiddleware(tokens: TokenService) {
  /** 401 si l'en-tête `Authorization: Bearer <jeton>` est absent, falsifié ou expiré. */
  const requireAuth: RequestHandler = async (req, _res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!match) throw unauthenticated();
    try {
      req.auth = await tokens.verify(match[1]!);
    } catch {
      throw unauthenticated();
    }
    next();
  };

  /** Authentifie puis vérifie le rôle : 401 sans session valide, 403 si le rôle ne convient pas. */
  const requireRole =
    (...roles: Role[]): RequestHandler =>
    async (req, res, next) => {
      await requireAuth(req, res, () => {});
      if (!roles.includes(req.auth!.role)) {
        throw new AppError(403, 'FORBIDDEN', "Votre compte n'a pas accès à cette action.");
      }
      next();
    };

  /**
   * Pour les routes publiques qui s'enrichissent si l'on est connecté (ex. `heldByMe`).
   * Sans en-tête : anonyme. En-tête présent mais invalide ou expiré : 401, pour que le front
   * reconnecte l'utilisateur au lieu de lui montrer ses places comme « bloquées par un autre ».
   */
  const optionalAuth: RequestHandler = async (req, res, next) => {
    if (req.headers.authorization === undefined) return next();
    await requireAuth(req, res, next);
  };

  return { requireAuth, requireRole, optionalAuth };
}

/** Utilisateur authentifié de la requête (à n'appeler que derrière requireAuth / requireRole). */
export function currentUser(req: Request): AuthUser {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
