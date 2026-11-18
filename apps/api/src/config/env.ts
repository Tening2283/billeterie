import { z } from 'zod';
import { MIN_REMAINING_HOLD_MS } from '@billetterie/shared';

const secret = z
  .string({ message: 'obligatoire' })
  .min(32, 'au moins 32 caractères aléatoires (ex. : openssl rand -base64 48)');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z
      .string({ message: 'obligatoire' })
      .regex(/^postgres(ql)?:\/\//, 'doit commencer par postgresql://'),
    JWT_SECRET: secret,
    // Signe les codes des billets (QR). Différent par environnement : un billet de test ne passe pas en prod.
    TICKET_SECRET: secret,
    // 12 en production (cahier des charges) ; 4 en test pour que la suite reste rapide.
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    REDIS_URL: z
      .string({ message: 'obligatoire' })
      .regex(/^rediss?:\/\//, 'doit commencer par redis:// ou rediss:// (Upstash : rediss://)'),
    // Isole les environnements qui partagent une base Redis (dev:, test:, prod:).
    REDIS_KEY_PREFIX: z.string().default(''),
    HOLD_TTL_MS: z.coerce.number().int().positive().default(600_000),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  // Deux usages, deux secrets : une fuite de l'un ne doit pas compromettre l'autre.
  .refine((env) => env.TICKET_SECRET !== env.JWT_SECRET, {
    message: 'doit être différent de JWT_SECRET',
    path: ['TICKET_SECRET'],
  })
  // La confirmation exige 5 s de blocage restant : en dessous, aucune réservation ne passerait.
  .refine((env) => env.HOLD_TTL_MS > MIN_REMAINING_HOLD_MS, {
    message: `doit dépasser ${MIN_REMAINING_HOLD_MS} ms (marge exigée à la confirmation)`,
    path: ['HOLD_TTL_MS'],
  });

export type Env = z.infer<typeof envSchema>;

/** Lit et valide les variables d'environnement ; s'arrête net si l'une est invalide. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Variables d'environnement invalides : ${problems}`);
  }
  return result.data;
}
