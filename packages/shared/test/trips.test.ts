import { describe, expect, it } from 'vitest';
import { searchTripsQuerySchema } from '../src';

describe('searchTripsQuerySchema', () => {
  it('accepte une recherche valide et nettoie les espaces', () => {
    expect(
      searchTripsQuerySchema.parse({ from: ' Dakar ', to: 'Thiès', date: '2026-11-20' }),
    ).toEqual({ from: 'Dakar', to: 'Thiès', date: '2026-11-20' });
  });

  it.each(['20/11/2026', '2026-13-01', '2026-02-30', ''])('refuse la date %j', (date) => {
    expect(searchTripsQuerySchema.safeParse({ from: 'Dakar', to: 'Thiès', date }).success).toBe(
      false,
    );
  });

  it('refuse une ville vide et les paramètres inconnus', () => {
    expect(
      searchTripsQuerySchema.safeParse({ from: ' ', to: 'Thiès', date: '2026-11-20' }).success,
    ).toBe(false);
    expect(
      searchTripsQuerySchema.safeParse({ from: 'Dakar', to: 'Thiès', date: '2026-11-20', x: 1 })
        .success,
    ).toBe(false);
  });
});
