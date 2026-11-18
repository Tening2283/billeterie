import { z } from 'zod';

/**
 * Plan d'un car : `rows` rangées de `columns` sièges, avec l'allée après la colonne `aisleAfter`.
 * Exemple 2+3 : { rows: 10, columns: 5, aisleAfter: 2 }.
 * Les places sont numérotées de 1 à seatCount, rangée par rangée, de gauche à droite ;
 * la dernière rangée peut être incomplète.
 */
export const busLayoutSchema = z
  .object({
    rows: z.number().int().positive(),
    columns: z.number().int().positive(),
    aisleAfter: z.number().int().nonnegative(),
  })
  .strict()
  .refine((l) => l.aisleAfter < l.columns, {
    message: "L'allée doit se trouver entre deux colonnes",
    path: ['aisleAfter'],
  });
export type BusLayout = z.infer<typeof busLayoutSchema>;

export interface SeatPosition {
  seatNumber: number;
  /** 0 = première rangée (à l'avant). */
  row: number;
  /** 0 = colonne la plus à gauche, allée non comptée. */
  column: number;
  /** Vrai pour le siège juste à gauche de l'allée : le front y insère l'espace. */
  aisleAfter: boolean;
}

/** Positions de toutes les places du car, dans l'ordre des numéros. */
export function buildSeatPositions(layout: BusLayout, seatCount: number): SeatPosition[] {
  const capacity = layout.rows * layout.columns;
  if (!Number.isInteger(seatCount) || seatCount <= 0 || seatCount > capacity) {
    throw new RangeError(`seatCount ${seatCount} incompatible avec un plan de ${capacity} sièges`);
  }
  return Array.from({ length: seatCount }, (_, index) => {
    const column = index % layout.columns;
    return {
      seatNumber: index + 1,
      row: Math.floor(index / layout.columns),
      column,
      aisleAfter: layout.aisleAfter > 0 && column === layout.aisleAfter - 1,
    };
  });
}

export function isValidSeatNumber(seatNumber: number, seatCount: number): boolean {
  return Number.isInteger(seatNumber) && seatNumber >= 1 && seatNumber <= seatCount;
}

/** Places restantes affichées dans la recherche : jamais négatif, même si les compteurs se croisent. */
export function remainingSeats(seatCount: number, soldCount: number, heldCount = 0): number {
  return Math.max(0, seatCount - soldCount - heldCount);
}
