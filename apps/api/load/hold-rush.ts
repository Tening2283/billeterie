/**
 * Test de charge : des centaines de voyageurs se ruent sur LA MÊME place, en même temps.
 *
 * Pour chaque manche (une place différente à chaque fois) :
 *  1. autocannon envoie LOAD_REQUESTS `POST /trips/:id/holds` sur cette place, LOAD_CONNECTIONS
 *     connexions simultanées, chaque requête au nom d'un voyageur DIFFÉRENT (un clic par personne).
 *     Attendu : exactement UN 201 (un seul gagnant), tout le reste 409 SEAT_TAKEN.
 *  2. Tous les voyageurs tentent `POST /bookings` sur cette place au même instant.
 *     Attendu : UNE réservation (celle du détenteur du blocage), les autres 409.
 * Enfin, contrôle en SQL : aucune place vendue deux fois, sur toute la base.
 *
 * Prérequis : l'API tourne (LOAD_BASE_URL) avec DISABLE_RATE_LIMITS=true (jamais en production),
 * et la base contient les départs de démo. DATABASE_URL sert au contrôle SQL et au nettoyage.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import autocannon, { type Result } from 'autocannon';
import { loadEnvFile } from '../src/config/load-env-file';
import { createDb } from '../src/lib/db';

loadEnvFile('.env');

const requests = Number(process.env.LOAD_REQUESTS ?? 1000);
const config = {
  baseUrl: (process.env.LOAD_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  requests,
  // Un voyageur par requête : le nombre de 201 est alors exactement le nombre de gagnants.
  users: Number(process.env.LOAD_USERS ?? requests),
  connections: Number(process.env.LOAD_CONNECTIONS ?? 100),
  rounds: Number(process.env.LOAD_ROUNDS ?? 5),
  cleanup: process.env.LOAD_CLEANUP !== 'false',
  /** Fichier où ajouter le résumé Markdown (dans la CI : $GITHUB_STEP_SUMMARY). */
  summaryFile: process.env.LOAD_SUMMARY_FILE,
  jsonFile: process.env.LOAD_JSON_FILE ?? 'load-results.json',
};

if (config.users < config.requests) {
  throw new Error('LOAD_USERS doit être ≥ LOAD_REQUESTS : un clic par voyageur et par manche');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL manquante (contrôle SQL des doubles ventes)');
const db = createDb(databaseUrl);
const runId = Date.now().toString(36);
const EMAIL_DOMAIN = '@charge.test';

async function api<T>(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${config.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = (response.status === 204 ? null : await response.json()) as T;
  return { status: response.status, body };
}

/** Exécute `task` sur tous les éléments, au plus `limit` à la fois. */
async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!);
      }
    }),
  );
  return results;
}

async function createTravelers(count: number): Promise<string[]> {
  return pool(
    Array.from({ length: count }, (_, i) => i),
    20,
    async (i) => {
      const { status, body } = await api<{ token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: `charge-${runId}-${i}${EMAIL_DOMAIN}`,
          password: `mot-de-passe-${runId}`,
          name: `Voyageur ${i}`,
        }),
      });
      if (status !== 201) {
        throw new Error(`Inscription ${i} : HTTP ${status} (DISABLE_RATE_LIMITS=true sur l'API ?)`);
      }
      return body.token;
    },
  );
}

async function pickTrip() {
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const query = new URLSearchParams({ from: 'Thiès', to: 'Saint-Louis', date });
  const { body } = await api<{ trips: { id: string; seatCount: number }[] }>(`/trips?${query}`);
  const trip = body.trips[0];
  if (!trip) throw new Error('Aucun départ Thiès → Saint-Louis demain : seed absent ?');
  const seats = await api<{ seats: { seatNumber: number; state: string }[] }>(
    `/trips/${trip.id}/seats`,
  );
  const free = seats.body.seats.filter((s) => s.state === 'free').map((s) => s.seatNumber);
  if (free.length < config.rounds) throw new Error(`Pas assez de places libres (${free.length})`);
  return { tripId: trip.id, seats: free.slice(0, config.rounds) };
}

interface RoundResult {
  seatNumber: number;
  holds: {
    total: number;
    requestsPerSecond: number;
    latencyMs: { p50: number; p90: number; p99: number; max: number };
    statusCounts: Record<string, number>;
    errors: number;
    timeouts: number;
  };
  bookings: { attempts: number; statusCounts: Record<string, number> };
}

function runAutocannon(
  tripId: string,
  seatNumber: number,
  tokens: string[],
): Promise<{ result: Result; statusCounts: Record<string, number> }> {
  const statusCounts: Record<string, number> = {};
  let next = 0;
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: config.baseUrl,
        connections: config.connections,
        amount: config.requests,
        timeout: 10,
        requests: [
          {
            method: 'POST',
            path: `/api/v1/trips/${tripId}/holds`,
            body: JSON.stringify({ seatNumber }),
            // Chaque requête au nom d'un nouveau voyageur : comme N personnes qui cliquent ensemble.
            setupRequest: (request) => ({
              ...request,
              headers: {
                ...request.headers,
                'content-type': 'application/json',
                authorization: `Bearer ${tokens[next++]}`,
              },
            }),
          },
        ],
      },
      (err, result) => (err ? reject(err) : resolve({ result, statusCounts })),
    );
    instance.on('response', (_client, statusCode) => {
      statusCounts[statusCode] = (statusCounts[statusCode] ?? 0) + 1;
    });
  });
}

async function runRound(
  tripId: string,
  seatNumber: number,
  tokens: string[],
): Promise<RoundResult> {
  const { result, statusCounts } = await runAutocannon(tripId, seatNumber, tokens);

  // Tous les voyageurs confirment en même temps : seul le détenteur du blocage doit réussir.
  const bookingStatuses = await Promise.all(
    tokens.map(async (token, i) => {
      const { status } = await api(
        '/bookings',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': `charge-${runId}-${seatNumber}-${i}` },
          body: JSON.stringify({
            tripId,
            passengers: [{ seatNumber, passengerName: `Voyageur ${i}` }],
          }),
        },
        token,
      );
      return status;
    }),
  );
  const bookingCounts: Record<string, number> = {};
  for (const status of bookingStatuses) bookingCounts[status] = (bookingCounts[status] ?? 0) + 1;

  return {
    seatNumber,
    holds: {
      total: result.requests.total,
      requestsPerSecond: Math.round(result.requests.average),
      latencyMs: {
        p50: result.latency.p50,
        p90: result.latency.p90,
        p99: result.latency.p99,
        max: result.latency.max,
      },
      statusCounts,
      errors: result.errors,
      timeouts: result.timeouts,
    },
    bookings: { attempts: tokens.length, statusCounts: bookingCounts },
  };
}

async function doubleSoldSeats(): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT trip_id, seat_number FROM tickets
      WHERE status <> 'cancelled'
      GROUP BY trip_id, seat_number
      HAVING count(*) > 1
    ) AS doubles`;
  return rows[0]?.n ?? 0;
}

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { startsWith: `charge-${runId}-`, endsWith: EMAIL_DOMAIN } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.ticket.deleteMany({ where: { booking: { userId: { in: ids } } } });
  await db.booking.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

function environment() {
  const cpu = cpus();
  return {
    cpu: `${cpu[0]?.model.trim() ?? 'inconnu'} × ${cpu.length}`,
    memory: `${Math.round(totalmem() / 1024 ** 3)} Go`,
    os: `${platform()} ${release()}`,
    node: process.version,
    where: process.env.GITHUB_ACTIONS ? 'GitHub Actions (ubuntu-latest)' : 'machine locale',
    apiUrl: config.baseUrl,
  };
}

function toMarkdown(env: ReturnType<typeof environment>, rounds: RoundResult[], doubles: number) {
  const fmt = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort()
      .map(([status, n]) => `${n} × ${status}`)
      .join(', ');
  const all = rounds.map((r) => r.holds);
  const okRounds = rounds.filter(
    (r) => r.holds.statusCounts['201'] === 1 && r.bookings.statusCounts['201'] === 1,
  ).length;
  return [
    '## Test de charge : ruée sur une même place',
    '',
    `- **Où** : ${env.where} — ${env.cpu}, ${env.memory}, ${env.os}, Node ${env.node}`,
    `- **Comment** : ${env.where.startsWith('GitHub') ? 'API, PostgreSQL et Redis sur la même machine' : `API locale, base et Redis distants`} ; autocannon, ${config.connections} connexions simultanées, ${config.requests} \`POST /holds\` par manche sur la même place, chacun par un voyageur différent, puis ${config.users} \`POST /bookings\` simultanés ; ${rounds.length} manches (une place par manche)`,
    '',
    '| Manche | Req/s | p50 | p90 | p99 | max | Réponses aux blocages | Confirmations |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rounds.map(
      (r) =>
        `| place ${r.seatNumber} | ${r.holds.requestsPerSecond} | ${r.holds.latencyMs.p50} ms | ${r.holds.latencyMs.p90} ms | ${r.holds.latencyMs.p99} ms | ${r.holds.latencyMs.max} ms | ${fmt(r.holds.statusCounts)} | ${fmt(r.bookings.statusCounts)} |`,
    ),
    '',
    `- **Débit moyen** : ${Math.round(all.reduce((s, h) => s + h.requestsPerSecond, 0) / all.length)} req/s ; **p99 le plus haut** : ${Math.max(...all.map((h) => h.latencyMs.p99))} ms ; erreurs réseau : ${all.reduce((s, h) => s + h.errors, 0)}, délais dépassés : ${all.reduce((s, h) => s + h.timeouts, 0)}`,
    `- **Manches avec exactement 1 gagnant du blocage et 1 vente** : ${okRounds} / ${rounds.length}`,
    `- **Places vendues deux fois (SQL, toute la base)** : **${doubles}**`,
    '',
  ].join('\n');
}

/** Base ou Redis qui se réveillent : on laisse 30 s à l'API pour répondre 200 sur /health. */
async function waitForHealthyApi() {
  let last = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    last = await api('/health').then(
      (r) => r.status,
      () => 0,
    );
    if (last === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`API pas prête : /health → ${last}`);
}

async function main() {
  const env = environment();
  console.log(`Test de charge sur ${config.baseUrl} — ${env.where}, ${env.cpu}`);
  await waitForHealthyApi();

  console.log(`Création de ${config.users} voyageurs…`);
  const tokens = await createTravelers(config.users);
  const { tripId, seats } = await pickTrip();

  const rounds: RoundResult[] = [];
  try {
    for (const seatNumber of seats) {
      const round = await runRound(tripId, seatNumber, tokens);
      rounds.push(round);
      console.log(
        `place ${seatNumber} : ${round.holds.requestsPerSecond} req/s, p99 ${round.holds.latencyMs.p99} ms, blocages ${JSON.stringify(round.holds.statusCounts)}, confirmations ${JSON.stringify(round.bookings.statusCounts)}`,
      );
    }
    const doubles = await doubleSoldSeats();
    const markdown = toMarkdown(env, rounds, doubles);
    console.log(`\n${markdown}`);
    writeFileSync(
      config.jsonFile,
      JSON.stringify({ environment: env, config, rounds, doubleSoldSeats: doubles }, null, 2),
    );
    if (config.summaryFile) appendFileSync(config.summaryFile, markdown);

    const failed = doubles > 0 || rounds.some((r) => r.holds.statusCounts['201'] !== 1);
    if (failed) {
      console.error('ÉCHEC : une place a été bloquée ou vendue plus d’une fois.');
      process.exitCode = 1;
    }
  } finally {
    if (config.cleanup) console.log(`Nettoyage : ${await cleanup()} voyageurs de test supprimés.`);
    await db.$disconnect();
  }
}

await main();
