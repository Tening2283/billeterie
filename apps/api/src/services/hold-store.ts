import type { Redis } from '../lib/redis';

/**
 * Stockage des blocages dans Redis.
 *  - `hold:{tripId}:{seat}` = userId, avec expiration (PX) : la place est bloquée tant que la clé existe.
 *  - `holds:expiry` (ensemble trié) : membre `{tripId}:{seat}`, score = échéance en ms. Sert au balayeur
 *    et à donner `expiresAt` sans un PTTL par place (moins de commandes, quota Upstash).
 */
export const EXPIRY_KEY = 'holds:expiry';
export const holdKey = (tripId: string, seat: number) => `hold:${tripId}:${seat}`;
export const holdMember = (tripId: string, seat: number) => `${tripId}:${seat}`;

export function parseHoldMember(member: string): { tripId: string; seatNumber: number } {
  const i = member.lastIndexOf(':');
  return { tripId: member.slice(0, i), seatNumber: Number(member.slice(i + 1)) };
}

/**
 * Bloque une place. Un seul aller-retour, exécuté d'un bloc par Redis : personne ne peut se glisser
 * entre la vérification de la limite de 4 places et la pose du blocage.
 * KEYS[1..n] : clés de toutes les places du car (n = nombre de places), KEYS[n+1] : holds:expiry.
 * ARGV : userId, numéro de place, durée (ms), limite, échéance (ms), membre.
 * Retour : {1, ttl} posé · {2, pttl} déjà bloquée par moi · {0, 0} prise par un autre · {-1, 0} limite.
 */
const HOLD_LUA = `
local n = #KEYS - 1
local seat = tonumber(ARGV[2])
local owners = redis.call('MGET', unpack(KEYS, 1, n))
local current = owners[seat]
if current == ARGV[1] then
  return {2, redis.call('PTTL', KEYS[seat])}
end
if current then
  return {0, 0}
end
local mine = 0
for i = 1, n do
  if owners[i] == ARGV[1] then mine = mine + 1 end
end
if mine >= tonumber(ARGV[4]) then
  return {-1, 0}
end
-- NX + PX dans la même commande : jamais de place bloquée sans expiration, jamais deux propriétaires.
if not redis.call('SET', KEYS[seat], ARGV[1], 'NX', 'PX', ARGV[3]) then
  return {0, 0}
end
redis.call('ZADD', KEYS[n + 1], ARGV[5], ARGV[6])
return {1, tonumber(ARGV[3])}
`;

/**
 * Libère une place seulement si elle appartient à l'utilisateur. Un GET puis un DEL en JavaScript
 * laisseraient le blocage expirer et être repris entre les deux : on supprimerait celui d'un autre.
 * KEYS : hold:…, holds:expiry · ARGV : userId, membre · Retour : 1 libérée, 0 pas (ou plus) à lui.
 */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[2])
  return 1
end
return 0
`;

/**
 * Retire de holds:expiry les blocages réellement expirés et les renvoie (une seule fois chacun).
 * Conditionnel et atomique : si la place a été rebloquée entre-temps (nouvelle échéance) ou si la clé
 * existe encore, on n'y touche pas. Deux balayeurs simultanés ne libèrent donc jamais deux fois.
 * KEYS[1] : holds:expiry, KEYS[2..] : hold:… · ARGV[1] : maintenant (ms), ARGV[2..] : membres.
 */
const SWEEP_LUA = `
local released = {}
for i = 2, #KEYS do
  local score = redis.call('ZSCORE', KEYS[1], ARGV[i])
  if score and tonumber(score) <= tonumber(ARGV[1]) and redis.call('EXISTS', KEYS[i]) == 0 then
    redis.call('ZREM', KEYS[1], ARGV[i])
    released[#released + 1] = ARGV[i]
  end
end
return released
`;

type Arg = string | number;

export interface HoldScripts {
  holdSeat(numKeys: number, ...args: Arg[]): Promise<[number, number]>;
  releaseSeat(numKeys: number, ...args: Arg[]): Promise<number>;
  sweepHolds(numKeys: number, ...args: Arg[]): Promise<string[]>;
}

export type HoldRedis = Redis & HoldScripts;

const registered = new WeakSet<Redis>();

/** Enregistre les scripts (EVALSHA mis en cache par ioredis ; préfixe de clés appliqué aux KEYS). */
export function withHoldScripts(redis: Redis): HoldRedis {
  if (!registered.has(redis)) {
    redis.defineCommand('holdSeat', { lua: HOLD_LUA });
    redis.defineCommand('releaseSeat', { lua: RELEASE_LUA });
    redis.defineCommand('sweepHolds', { lua: SWEEP_LUA });
    registered.add(redis);
  }
  return redis as HoldRedis;
}
