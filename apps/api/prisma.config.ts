import { defineConfig } from 'prisma/config';
import { loadEnvFile } from './src/config/load-env-file';

// Le CLI Prisma ne lit plus .env tout seul. Les variables déjà définies (CI, tests, Render) gardent la priorité.
loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Migrations : URL directe (sans PgBouncer). L'appli, elle, utilise DATABASE_URL (pooled) via l'adaptateur pg.
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
