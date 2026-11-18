import { rateLimit, type RateLimitInfo, type ValueDeterminingMiddleware } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { AppError } from '../lib/app-error';

export interface RateLimitOptions {
  /** Requêtes autorisées par fenêtre. */
  limit: number;
  windowMs?: number;
  /** Par défaut : l'adresse IP (correcte derrière Render grâce à `trust proxy`). */
  keyGenerator?: ValueDeterminingMiddleware<string>;
}

/** Limiteur en mémoire (une seule instance d'API dans le MVP), avec le format d'erreur standard. */
export function createRateLimiter({
  limit,
  windowMs = 60_000,
  keyGenerator,
}: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, _res, next) => {
      // Temps réellement restant avant la remise à zéro du compteur (et non toute la fenêtre).
      // (express-rate-limit renseigne req.rateLimit, sans l'ajouter aux types d'Express.)
      const { resetTime } = (req as typeof req & { rateLimit?: RateLimitInfo }).rateLimit ?? {};
      const retryAfterSeconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          `Trop de tentatives. Réessayez dans ${retryAfterSeconds} s.`,
          { retryAfterSeconds },
        ),
      );
    },
  });
}
