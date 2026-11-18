import { Router, type RequestHandler } from 'express';
import {
  createBookingBodySchema,
  idempotencyKeySchema,
  verifyTicketBodySchema,
  type Booking,
  type MyBookingsResponse,
  type Role,
  type TicketCodeResponse,
  type VerifyTicketResponse,
} from '@billetterie/shared';
import { AppError } from '../lib/app-error';
import { currentUser } from '../middleware/auth';
import type { BookingService } from '../services/bookings';
import type { TicketService } from '../services/tickets';

export interface BookingsRouterDeps {
  bookings: BookingService;
  tickets: TicketService;
  requireAuth: RequestHandler;
  requireRole: (...roles: Role[]) => RequestHandler;
}

export function bookingsRouter({
  bookings,
  tickets,
  requireAuth,
  requireRole,
}: BookingsRouterDeps): Router {
  const router = Router();
  const travelerOnly = requireRole('traveler');

  router.post('/bookings', travelerOnly, async (req, res) => {
    const key = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
    if (!key.success) {
      throw new AppError(400, 'VALIDATION_ERROR', key.error.issues[0]!.message, {
        header: 'Idempotency-Key',
      });
    }
    const input = createBookingBodySchema.parse(req.body);

    const { booking, replayed } = await bookings.create(currentUser(req).id, key.data, input);

    // Requête rejouée : même réponse que la première fois (convention utilisée par Stripe).
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    const body: Booking = booking;
    res.status(201).json(body);
  });

  router.get('/bookings/me', travelerOnly, async (req, res) => {
    const body: MyBookingsResponse = { bookings: await bookings.listForUser(currentUser(req).id) };
    res.json(body);
  });

  router.get('/tickets/:id/code', requireAuth, async (req, res) => {
    const body: TicketCodeResponse = await tickets.codeFor(
      currentUser(req).id,
      String(req.params.id),
    );
    res.json(body);
  });

  router.post('/tickets/verify', requireRole('controller', 'admin'), async (req, res) => {
    const { code } = verifyTicketBodySchema.parse(req.body);
    const body: VerifyTicketResponse = await tickets.verify(code);
    res.json(body);
  });

  return router;
}
