import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db';
import { createHoldService } from '../src/services/holds';
import { holdKey } from '../src/services/hold-store';
import { createTrip, createUser, resetDb, sellSeats, testDb } from './db';
import { resetRedis, testRedis } from './redis';
import { recordingEvents } from './helpers';

beforeEach(async () => {
  await Promise.all([resetDb(), resetRedis()]);
});

/**
 * Base vue « juste avant la vente » : le premier contrôle des billets ne voit pas encore la vente,
 * qui se termine pendant que le blocage est posé dans Redis. Les requêtes suivantes voient la base réelle.
 */
function dbBeforeSaleCommits(): Db {
  let firstCheck = true;
  const ticket = new Proxy(testDb.ticket, {
    get(target, prop, receiver) {
      if (prop === 'findFirst' && firstCheck) {
        firstCheck = false;
        return async () => null;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return new Proxy(testDb, {
    get: (target, prop, receiver) =>
      prop === 'ticket' ? ticket : Reflect.get(target, prop, receiver),
  });
}

describe('course entre une vente et un nouveau blocage', () => {
  it('une place vendue pendant la pose du blocage est relâchée aussitôt : 409, aucun seat:held', async () => {
    const trip = await createTrip();
    const user = await createUser();
    await sellSeats(trip.id, [5]); // la vente « concurrente » est validée en base
    const events = recordingEvents();
    const holds = createHoldService({ db: dbBeforeSaleCommits(), redis: testRedis, events });

    const attempt = holds.hold(user.id, trip.id, 5);

    await expect(attempt).rejects.toMatchObject({ status: 409, code: 'SEAT_TAKEN' });
    expect(await testRedis.exists(holdKey(trip.id, 5))).toBe(0);
    expect(events.log).toEqual([]);
  });
});
