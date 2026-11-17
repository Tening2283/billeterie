# Billetterie de cars en temps réel

Réservation de places de cars interurbains (Dakar, Thiès, Saint-Louis…) sur un plan du car mis à jour en direct.

> Projet en construction : étape 0 (mise en place) terminée. Le README complet (démo, GIF, décisions techniques, chiffres mesurés) arrive à l'étape 7.

## Structure

```
apps/api/         Express 5 + (bientôt) Socket.io, Prisma, Redis
apps/web/         React 19 + Vite + Tailwind
packages/shared/  Schémas Zod et types partagés (format d'erreur, réponses de l'API)
```

## Lancer en local

Prérequis : Node.js 22 ou plus.

```bash
npm install
cp apps/api/.env.example apps/api/.env

npm run dev:api   # http://localhost:3000/api/v1/health
npm run dev:web   # http://localhost:5173
```

## Vérifications (identiques à la CI)

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage   # échoue sous 80 % de couverture
npm run build
```
