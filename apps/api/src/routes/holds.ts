import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { createHoldBodySchema, type HoldResponse } from '@billetterie/shared';
import { AppError } from '../lib/app-error';
import type { HoldService } from '../services/holds';
import { currentUser } from '../middleware/auth';

const seatParam = z.coerce.number().int().positive();

export interface HoldsRouterDeps {
  holds: HoldService;
  /** requireRole('traveler') puis limitation 30/min par utilisateur. */
  guards: RequestHandler[];
}

export function holdsRouter({ holds, guards }: HoldsRouterDeps): Router {
  const router = Router();

  router.post('/trips/:id/holds', ...guards, async (req, res) => {
    const { seatNumber } = createHoldBodySchema.parse(req.body);
    const body: HoldResponse = await holds.hold(
      currentUser(req).id,
      String(req.params.id),
      seatNumber,
    );
    res.status(201).json(body);
  });

  router.delete('/trips/:id/holds/:seatNumber', ...guards, async (req, res) => {
    const seat = seatParam.safeParse(req.params.seatNumber);
    if (!seat.success) {
      throw new AppError(
        404,
        'NOT_FOUND',
        'Vous ne bloquez pas cette place (ou le blocage a expiré).',
      );
    }
    await holds.release(currentUser(req).id, String(req.params.id), seat.data);
    res.status(204).end();
  });

  return router;
}
