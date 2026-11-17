import { describe, expect, it } from 'vitest';
import { isApiError } from '../src';

describe('isApiError', () => {
  it('accepte le format d’erreur standard', () => {
    expect(
      isApiError({
        error: { code: 'SEAT_TAKEN', message: 'Cette place vient d’être prise.', details: {} },
      }),
    ).toBe(true);
  });

  it('refuse un code inconnu', () => {
    expect(isApiError({ error: { code: 'OOPS', message: 'x', details: {} } })).toBe(false);
  });

  it('refuse un corps sans enveloppe error', () => {
    expect(isApiError({ code: 'SEAT_TAKEN', message: 'x' })).toBe(false);
  });
});
