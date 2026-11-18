import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { DemoLoginInput } from '@billetterie/shared';
import type { Db } from '../lib/db';
import type { User } from '../generated/prisma/client';
import { DEMO_USERS } from './catalog';

/**
 * Renvoie le compte de démo du rôle demandé, en le créant s'il manque (base neuve ou remise à zéro).
 * Son mot de passe est aléatoire et jamais communiqué : on y accède uniquement via POST /auth/demo.
 * Si le compte existe avec un autre rôle (créé avant la protection du domaine, ou modifié à la main),
 * on le répare : bon rôle et nouveau mot de passe aléatoire, pour que personne n'en garde l'accès.
 */
export async function ensureDemoUser(
  db: Db,
  role: DemoLoginInput['role'],
  bcryptCost: number,
): Promise<User> {
  const demo = DEMO_USERS.find((u) => u.role === role)!;
  const existing = await db.user.findUnique({ where: { email: demo.email } });
  if (existing?.role === demo.role) return existing;

  const passwordHash = await bcrypt.hash(randomBytes(24).toString('base64url'), bcryptCost);
  return db.user.upsert({
    where: { email: demo.email },
    create: { ...demo, passwordHash },
    update: { role: demo.role, name: demo.name, passwordHash },
  });
}
