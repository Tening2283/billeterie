import type { Db } from '../lib/db';
import { DEMO_LINES, type DemoLine } from './catalog';

const DAY_MS = 86_400_000;

export interface EnsureUpcomingTripsOptions {
  days?: number;
  now?: Date;
  lines?: DemoLine[];
}

/**
 * Garantit que la démo a toujours des départs à venir : crée, pour les `days` prochains jours,
 * les départs des lignes du catalogue qui manquent. Idempotent (unique route_id + departure_at),
 * donc sans risque à chaque démarrage de l'API. Retourne le nombre de départs créés.
 */
export async function ensureUpcomingTrips(
  db: Db,
  { days = 14, now = new Date(), lines = DEMO_LINES }: EnsureUpcomingTripsOptions = {},
): Promise<number> {
  const [routes, buses] = await Promise.all([db.route.findMany(), db.bus.findMany()]);
  const routeId = new Map(routes.map((r) => [`${r.origin}→${r.destination}`, r.id]));
  const busId = new Map(buses.map((b) => [b.name, b.id]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const data = lines.flatMap((line) => {
    const route = routeId.get(`${line.origin}→${line.destination}`);
    const bus = busId.get(line.busName);
    if (!route || !bus) return []; // Catalogue pas encore en base : rien à faire pour cette ligne.

    return Array.from({ length: days }, (_, day) =>
      line.departureHours.map((hour) => new Date(today + day * DAY_MS + hour * 3_600_000)),
    )
      .flat()
      .filter((departureAt) => departureAt > now)
      .map((departureAt) => ({
        routeId: route,
        busId: bus,
        departureAt,
        priceFcfa: line.priceFcfa,
      }));
  });

  const { count } = await db.trip.createMany({ data, skipDuplicates: true });
  return count;
}
