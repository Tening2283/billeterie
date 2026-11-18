import bcrypt from 'bcryptjs';
import type {
  AuthResponse,
  DemoLoginInput,
  LoginInput,
  PublicUser,
  RegisterInput,
} from '@billetterie/shared';
import { AppError } from '../lib/app-error';
import { isUniqueViolation, type Db } from '../lib/db';
import type { TokenService } from '../lib/tokens';
import { ensureDemoUser } from '../demo/demo-users';
import { isDemoEmail } from '../demo/catalog';
import type { User } from '../generated/prisma/client';

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResponse>;
  login(input: LoginInput): Promise<AuthResponse>;
  demoLogin(input: DemoLoginInput): Promise<AuthResponse>;
  me(userId: string): Promise<PublicUser>;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect.');

export function toPublicUser(user: Pick<User, 'id' | 'email' | 'name' | 'role'>): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function createAuthService(
  db: Db,
  tokens: TokenService,
  { bcryptCost = 12 } = {},
): AuthService {
  // Hachage factice : un e-mail inconnu coûte autant qu'un mauvais mot de passe,
  // pour ne pas révéler par le temps de réponse quels e-mails ont un compte.
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= bcrypt.hash('mot-de-passe-factice', bcryptCost));

  async function issue(user: User): Promise<AuthResponse> {
    const { token, expiresAt } = await tokens.sign({ id: user.id, role: user.role });
    return { token, expiresAt: expiresAt.toISOString(), user: toPublicUser(user) };
  }

  return {
    async register({ email, password, name }) {
      // Sinon, s'inscrire avec voyageur@demo.test avant le seed donnerait le compte de démo partagé
      // (et les billets de tous ses visiteurs) à quelqu'un qui en connaît le mot de passe.
      if (isDemoEmail(email)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Cette adresse est réservée aux comptes de démo.',
          {
            issues: [{ path: ['email'], message: 'Adresse réservée' }],
          },
        );
      }
      const passwordHash = await bcrypt.hash(password, bcryptCost);
      try {
        // Rôle toujours voyageur à l'inscription : contrôleurs et admins ne s'auto-créent pas.
        const user = await db.user.create({
          data: { email, passwordHash, name, role: 'traveler' },
        });
        return await issue(user);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(409, 'EMAIL_TAKEN', 'Un compte existe déjà avec cet e-mail.');
        }
        throw error;
      }
    },

    async login({ email, password }) {
      const user = await db.user.findUnique({ where: { email } });
      const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !ok) throw invalidCredentials();
      return issue(user);
    },

    async demoLogin({ role }) {
      return issue(await ensureDemoUser(db, role, bcryptCost));
    },

    async me(userId) {
      const user = await db.user.findUnique({ where: { id: userId } });
      // Jeton valide mais compte supprimé : la session n'a plus de sens.
      if (!user) {
        throw new AppError(401, 'UNAUTHENTICATED', "Ce compte n'existe plus. Reconnectez-vous.");
      }
      return toPublicUser(user);
    },
  };
}
