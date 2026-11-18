import type { ZodType } from 'zod';
import { isApiError, type ErrorCode } from '@billetterie/shared';
import { API_BASE } from './config';
import { sessionStore } from './session';

/** Codes de l'API, plus NETWORK_ERROR quand le serveur n'a pas pu être joint. */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR';

/** Erreur affichable telle quelle : `message` vient du format d'erreur standard de l'API. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export const isApiRequestError = (error: unknown, ...codes: ClientErrorCode[]) =>
  error instanceof ApiRequestError && (codes.length === 0 || codes.includes(error.code));

/** Message à montrer à l'utilisateur, quelle que soit l'erreur. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Une erreur inattendue est survenue.';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Appel à l'API : ajoute le jeton, valide la réponse avec le schéma Zod partagé
 * et transforme toute erreur en ApiRequestError.
 */
export async function apiRequest<T>(
  path: string,
  schema: ZodType<T> | null,
  options: RequestOptions = {},
): Promise<T> {
  const token = sessionStore.token();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Impossible de joindre le serveur. Vérifiez votre connexion.',
    );
  }

  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    // Jeton expiré ou révoqué : on déconnecte proprement.
    if (response.status === 401 && token) sessionStore.clear();
    if (isApiError(body)) {
      const { code, message, details } = body.error;
      throw new ApiRequestError(response.status, code, message, details);
    }
    throw new ApiRequestError(
      response.status,
      response.status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR',
      `Le serveur a répondu ${response.status}.`,
    );
  }

  if (!schema) return undefined as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiRequestError(response.status, 'INTERNAL_ERROR', 'Réponse inattendue du serveur.');
  }
  return parsed.data;
}
