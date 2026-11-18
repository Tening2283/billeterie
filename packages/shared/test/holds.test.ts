import { describe, expect, it } from 'vitest';
import { createHoldBodySchema, tripRoom } from '../src';

describe('createHoldBodySchema', () => {
  it('accepte un numéro de place entier positif', () => {
    expect(createHoldBodySchema.parse({ seatNumber: 12 })).toEqual({ seatNumber: 12 });
  });

  it.each([{ seatNumber: 0 }, { seatNumber: 1.5 }, { seatNumber: '3' }, { seatNumber: 3, x: 1 }])(
    'refuse %j',
    (body) => {
      expect(createHoldBodySchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('tripRoom', () => {
  it('préfixe l’identifiant du trajet', () => {
    expect(tripRoom('abc')).toBe('trip:abc');
  });
});
