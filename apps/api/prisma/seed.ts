import { loadEnvFile } from '../src/config/load-env-file';
import { createDb } from '../src/lib/db';
import { seedDemoCatalog } from '../src/demo/seed-catalog';
import { ensureUpcomingTrips } from '../src/demo/ensure-upcoming-trips';

loadEnvFile('.env');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL manquante (apps/api/.env)');

const db = createDb(url);
try {
  await seedDemoCatalog(db);
  const created = await ensureUpcomingTrips(db);
  const [routes, buses, users, trips] = await Promise.all([
    db.route.count(),
    db.bus.count(),
    db.user.count(),
    db.trip.count(),
  ]);
  console.log(
    `Seed terminé : ${routes} lignes, ${buses} cars, ${users} comptes, ${trips} départs (${created} nouveaux).`,
  );
} finally {
  await db.$disconnect();
}
