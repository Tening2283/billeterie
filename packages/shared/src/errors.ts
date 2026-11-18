import { z } from 'zod';

/** Codes d'erreur métier renvoyés par l'API. Le front s'appuie dessus pour réagir (toast, rechargement…). */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'TRIP_CLOSED',
  'SEAT_TAKEN',
  'HOLD_LIMIT',
  'HOLD_EXPIRED',
  'SEAT_SOLD',
  'IDEMPOTENCY_KEY_REUSED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Format unique de toutes les erreurs : `{ error: { code, message, details } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function isApiError(value: unknown): value is ApiError {
  return apiErrorSchema.safeParse(value).success;
}
