import type { Db } from '../lib/db';
import { DEMO_BUSES, DEMO_LINES } from './catalog';
import { ensureDemoUser } from './demo-users';

/**
 * Crée ou met à jour cars, lignes et comptes de démo. Idempotent : peut être relancé sans risque.
 * Requêtes en parallèle / groupées : depuis Dakar, chaque aller-retour vers Frankfurt coûte ~100 ms.
 */
export async function seedDemoCatalog(db: Db, { bcryptCost = 12 } = {}): Promise<void> {
  await Promise.all([
    ...DEMO_BUSES.map((bus) =>
      db.bus.upsert({
        where: { name: bus.name },
        create: bus,
        update: { seatCount: bus.seatCount, layout: bus.layout },
      }),
    ),
    db.route.createMany({
      data: DEMO_LINES.map(({ origin, destination }) => ({ origin, destination })),
      skipDuplicates: true,
    }),
    ensureDemoUser(db, 'traveler', bcryptCost),
    ensureDemoUser(db, 'controller', bcryptCost),
  ]);
}
