import { execSync } from 'node:child_process';

/** Une fois avant tous les tests : garde-fous, puis migrations de la base de test (idempotent). */
export default function setup(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'NODE_ENV doit valoir "test" : les tests vident la base. Créez apps/api/.env.test (voir .env.example).',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquante pour les tests (apps/api/.env.test).');
  }
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL manquante pour les tests (apps/api/.env.test).');
  }
  // Les tests suppriment toutes les clés de leur préfixe : il doit être propre aux tests.
  if (!process.env.REDIS_KEY_PREFIX?.startsWith('test')) {
    throw new Error('REDIS_KEY_PREFIX doit commencer par "test" (ex. "test:") pour les tests.');
  }
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
