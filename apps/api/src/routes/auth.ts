import { Router, type RequestHandler } from 'express';
import {
  demoLoginSchema,
  loginSchema,
  registerSchema,
  type AuthResponse,
  type PublicUser,
} from '@billetterie/shared';
import type { AuthService } from '../services/auth';
import { currentUser } from '../middleware/auth';

export interface AuthRouterDeps {
  auth: AuthService;
  requireAuth: RequestHandler;
  limiters: { register: RequestHandler; login: RequestHandler; demo: RequestHandler };
}

export function authRouter({ auth, requireAuth, limiters }: AuthRouterDeps): Router {
  const router = Router();

  router.post('/auth/register', limiters.register, async (req, res) => {
    const body: AuthResponse = await auth.register(registerSchema.parse(req.body));
    res.status(201).json(body);
  });

  router.post('/auth/login', limiters.login, async (req, res) => {
    const body: AuthResponse = await auth.login(loginSchema.parse(req.body));
    res.json(body);
  });

  router.post('/auth/demo', limiters.demo, async (req, res) => {
    const body: AuthResponse = await auth.demoLogin(demoLoginSchema.parse(req.body));
    res.json(body);
  });

  router.get('/auth/me', requireAuth, async (req, res) => {
    const body: PublicUser = await auth.me(currentUser(req).id);
    res.json(body);
  });

  return router;
}
