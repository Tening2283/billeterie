import { z } from 'zod';

export const ROLES = ['traveler', 'controller', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** E-mail nettoyé (espaces, majuscules) avant validation : « Awa@Mail.com » et « awa@mail.com » = un seul compte. */
const email = z
  .string({ message: 'E-mail obligatoire' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'E-mail invalide' }).max(254));

/** bcrypt ignore tout ce qui dépasse 72 octets : on refuse plutôt que de tronquer en silence. */
const newPassword = z
  .string({ message: 'Mot de passe obligatoire' })
  .min(8, 'Au moins 8 caractères')
  .refine((p) => new TextEncoder().encode(p).length <= 72, 'Au plus 72 octets');

export const registerSchema = z
  .object({
    email,
    password: newPassword,
    name: z.string({ message: 'Nom obligatoire' }).trim().min(2, 'Au moins 2 caractères').max(80),
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email,
    password: z
      .string({ message: 'Mot de passe obligatoire' })
      .min(1, 'Mot de passe obligatoire')
      .max(200),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

/** Comptes de démo : seulement voyageur ou contrôleur, jamais admin. */
export const demoLoginSchema = z.object({ role: z.enum(['traveler', 'controller']) }).strict();
export type DemoLoginInput = z.infer<typeof demoLoginSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  /** Fin de validité du jeton (ISO) : le front déconnecte proprement à cette date. */
  expiresAt: z.iso.datetime(),
  user: publicUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
