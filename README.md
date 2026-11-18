# Billetterie de cars en temps réel

Réservation de places de cars interurbains (Dakar, Thiès, Saint-Louis…) sur un plan du car mis à jour en direct.

> Projet en construction : étapes 0 (mise en place), 1 (données), 2 (comptes et rôles) et 3 (blocage en temps réel) terminées. Le README complet (démo, GIF, décisions techniques, chiffres mesurés) arrive à l'étape 7.

## Structure

```
apps/api/         Express 5, Prisma 7 + PostgreSQL ; bientôt Socket.io et Redis
apps/web/         React 19 + Vite + Tailwind
packages/shared/  Schémas Zod et types partagés (erreurs, trajets, plan du car)
```

## Lancer en local

Prérequis : Node.js 22 ou plus, une base PostgreSQL (Neon : une branche `dev`, une branche `test`) et un Redis (Upstash, ou Memurai en local) ; dev et tests peuvent partager le même Redis grâce à `REDIS_KEY_PREFIX` (`dev:` / `test:`).

```bash
npm install                                   # génère aussi le client Prisma
cp apps/api/.env.example apps/api/.env        # URL de la branche dev
cp apps/api/.env.example apps/api/.env.test   # URL de la branche test, NODE_ENV=test

npm run db:migrate -w @billetterie/api        # applique les migrations sur dev
npm run db:seed -w @billetterie/api           # lignes, cars, comptes et départs de démo

npm run dev:api   # http://localhost:3000/api/v1/health
npm run dev:web   # http://localhost:5173
```

Voir le temps réel sans le front : ouvrir **http://localhost:3000/dev/** dans deux onglets (chacun crée son voyageur), cliquer une place dans l'un, elle change dans l'autre. Page servie uniquement hors production.

Exemples :

- `GET http://localhost:3000/api/v1/trips?from=Dakar&to=Thi%C3%A8s&date=2026-11-18`
- `POST http://localhost:3000/api/v1/auth/demo` avec `{"role":"traveler"}` ou `{"role":"controller"}` : jeton d'un compte de démo, à envoyer ensuite dans `Authorization: Bearer <jeton>`.

## Vérifications (identiques à la CI)

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage   # vraie base de test (.env.test) ; échoue sous 80 % de couverture
npm run build
```

Les tests d'intégration vident la base de test entre deux tests : ils refusent de démarrer si `NODE_ENV` ne vaut pas `test`.

## Limites connues (assumées)

- **Comptes de démo publics.** `POST /auth/demo` donne à n'importe qui un jeton voyageur ou contrôleur, comme le veut une démo en libre accès. Conséquence : quelqu'un qui obtient le QR code d'un autre (capture d'écran) peut le faire passer à « utilisé » avec le contrôleur de démo. Acceptable pour une démo ; en vrai service, les contrôleurs seraient de vrais comptes et la démo remise à zéro chaque nuit. Les adresses `@demo.test` sont réservées : personne ne peut s'inscrire avec pour s'approprier un compte de démo.
- **Redis non « cluster ».** Le script Lua de blocage lit toutes les places d'un trajet et l'ensemble trié global `holds:expiry` en une fois. C'est correct sur un Redis à un seul nœud (Upstash régional, Memurai), pas sur Redis Cluster (erreur `CROSSSLOT`), qui demanderait de répartir les échéances par trajet.
