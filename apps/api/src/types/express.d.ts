import type { AuthUser } from '../lib/tokens';

declare global {
  namespace Express {
    interface Request {
      /** Renseigné par requireAuth / requireRole. */
      auth?: AuthUser;
    }
  }
}

export {};
