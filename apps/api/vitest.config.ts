import { defineConfig } from 'vitest/config';
import { loadEnvFile } from './src/config/load-env-file.ts';

// En local : base de test Neon (branche « test »). En CI : variables du workflow (prioritaires).
// Chargé ici, avant le lancement des workers, qui héritent donc de ces variables.
loadEnvFile('.env.test');

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Les tests d'intégration partagent une vraie base et la vident entre deux tests : un fichier à la fois.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // server.ts : point d'entrée du processus. generated : client Prisma généré.
      exclude: ['src/server.ts', 'src/generated/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
