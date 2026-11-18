import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export type Db = PrismaClient;

/** Prisma 7 parle à PostgreSQL via le pilote `pg` (URL « pooled » de Neon en production). */
export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Vrai si l'erreur vient d'une contrainte d'unicité (Prisma P2002 / PostgreSQL 23505). */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === 'P2002' || code === '23505' || (cause !== undefined && isUniqueViolation(cause));
}
