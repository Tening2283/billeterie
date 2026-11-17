import type { ErrorCode } from '@billetterie/shared';

/** Erreur métier : le gestionnaire d'erreurs la transforme en `{ error: { code, message, details } }`. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
