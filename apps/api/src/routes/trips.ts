import { Router, type RequestHandler } from 'express';
import {
  searchTripsQuerySchema,
  type SearchTripsResponse,
  type TripDetail,
  type TripSeatsResponse,
} from '@billetterie/shared';
import type { Db } from '../lib/db';
import { AppError } from '../lib/app-error';
import type { HoldService } from '../services/holds';
import { getTrip, getTripSeats, searchTrips } from '../services/trips';

const tripNotFound = () => new AppError(404, 'NOT_FOUND', 'Ce trajet est introuvable.');

export interface TripsRouterDeps {
  db: Db;
  holds: HoldService;
  optionalAuth: RequestHandler;
}

export function tripsRouter({ db, holds, optionalAuth }: TripsRouterDeps): Router {
  const router = Router();

  router.get('/trips', async (req, res) => {
    const query = searchTripsQuerySchema.parse(req.query);
    const body: SearchTripsResponse = { trips: await searchTrips(db, query) };
    res.json(body);
  });

  router.get('/trips/:id', async (req, res) => {
    const trip = await getTrip(db, req.params.id);
    if (!trip) throw tripNotFound();
    const body: TripDetail = trip;
    res.json(body);
  });

  router.get('/trips/:id/seats', optionalAuth, async (req, res) => {
    // Avec un middleware en amont, Express ne déduit plus le type des paramètres de route.
    const id = String(req.params.id);
    const seats = await getTripSeats(db, holds, id, req.auth?.id);
    if (!seats) throw tripNotFound();
    const body: TripSeatsResponse = { tripId: id, seats };
    res.json(body);
  });

  return router;
}
