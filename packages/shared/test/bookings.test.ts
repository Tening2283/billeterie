import { describe, expect, it } from 'vitest';
import { createBookingBodySchema, idempotencyKeySchema, verifyTicketBodySchema } from '../src';

const tripId = '11111111-1111-4111-8111-111111111111';
const passenger = (seatNumber: number) => ({ seatNumber, passengerName: `Passager ${seatNumber}` });

describe('createBookingBodySchema', () => {
  it('accepte 1 à 4 passagers et nettoie les noms', () => {
    const parsed = createBookingBodySchema.parse({
      tripId,
      passengers: [{ seatNumber: 3, passengerName: '  Awa Diop ' }],
    });
    expect(parsed.passengers[0]?.passengerName).toBe('Awa Diop');
  });

  it.each([
    ['aucun passager', { tripId, passengers: [] }],
    ['5 passagers', { tripId, passengers: [1, 2, 3, 4, 5].map(passenger) }],
    ['place en double', { tripId, passengers: [passenger(2), passenger(2)] }],
    ['nom trop court', { tripId, passengers: [{ seatNumber: 1, passengerName: ' A ' }] }],
    ['trajet mal formé', { tripId: 'abc', passengers: [passenger(1)] }],
    ['champ inconnu', { tripId, passengers: [passenger(1)], totalFcfa: 0 }],
  ])('refuse : %s', (_label, body) => {
    expect(createBookingBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('accepte un UUID', () => {
    expect(idempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  it.each([undefined, 'court', 'a'.repeat(129), 'avec espace 123', 'é'.repeat(10)])(
    'refuse %j',
    (key) => {
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
    },
  );
});

describe('verifyTicketBodySchema', () => {
  it('exige un code non vide et pas démesuré', () => {
    expect(verifyTicketBodySchema.safeParse({ code: 'abc.def' }).success).toBe(true);
    expect(verifyTicketBodySchema.safeParse({ code: '  ' }).success).toBe(false);
    expect(verifyTicketBodySchema.safeParse({ code: 'x'.repeat(513) }).success).toBe(false);
  });
});
