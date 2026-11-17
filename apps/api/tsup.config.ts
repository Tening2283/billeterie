import { defineConfig } from 'tsup';

// Un seul fichier dist/server.js. Le paquet partagé (sources TypeScript) est intégré au bundle ;
// les autres dépendances restent dans node_modules.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  noExternal: ['@billetterie/shared'],
});
