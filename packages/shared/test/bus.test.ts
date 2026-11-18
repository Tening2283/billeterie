import { describe, expect, it } from 'vitest';
import { buildSeatPositions, busLayoutSchema, isValidSeatNumber, remainingSeats } from '../src';

describe('buildSeatPositions', () => {
  const coach = { rows: 10, columns: 5, aisleAfter: 2 }; // car 2+3, 50 places

  it('numérote rangée par rangée, de gauche à droite', () => {
    const seats = buildSeatPositions(coach, 50);

    expect(seats).toHaveLength(50);
    expect(seats[0]).toEqual({ seatNumber: 1, row: 0, column: 0, aisleAfter: false });
    expect(seats[1]).toEqual({ seatNumber: 2, row: 0, column: 1, aisleAfter: true });
    expect(seats[5]).toEqual({ seatNumber: 6, row: 1, column: 0, aisleAfter: false });
    expect(seats[49]).toEqual({ seatNumber: 50, row: 9, column: 4, aisleAfter: false });
  });

  it('accepte une dernière rangée incomplète', () => {
    const seats = buildSeatPositions({ rows: 4, columns: 4, aisleAfter: 2 }, 14);

    expect(seats.at(-1)).toEqual({ seatNumber: 14, row: 3, column: 1, aisleAfter: true });
  });

  it('sans allée (aisleAfter = 0), aucun siège ne la borde', () => {
    const seats = buildSeatPositions({ rows: 1, columns: 3, aisleAfter: 0 }, 3);

    expect(seats.every((s) => !s.aisleAfter)).toBe(true);
  });

  it.each([0, -1, 51, 2.5])('refuse seatCount = %s', (seatCount) => {
    expect(() => buildSeatPositions(coach, seatCount)).toThrow(RangeError);
  });
});

describe('busLayoutSchema', () => {
  it('refuse une allée hors du car', () => {
    expect(busLayoutSchema.safeParse({ rows: 5, columns: 3, aisleAfter: 3 }).success).toBe(false);
  });

  it('refuse les champs inconnus', () => {
    expect(
      busLayoutSchema.safeParse({ rows: 5, columns: 3, aisleAfter: 1, driver: true }).success,
    ).toBe(false);
  });
});

describe('isValidSeatNumber', () => {
  it.each([
    [1, true],
    [15, true],
    [0, false],
    [16, false],
    [3.5, false],
  ])('place %s dans un car de 15 : %s', (seat, expected) => {
    expect(isValidSeatNumber(seat, 15)).toBe(expected);
  });
});

describe('remainingSeats', () => {
  it('retire les places vendues et bloquées', () => {
    expect(remainingSeats(50, 10, 3)).toBe(37);
    expect(remainingSeats(15, 4)).toBe(11);
  });

  it('ne descend jamais sous zéro', () => {
    expect(remainingSeats(15, 15, 2)).toBe(0);
  });
});
