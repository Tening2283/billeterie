import { describe, expect, it, vi } from 'vitest';
import { authResponseSchema } from '@billetterie/shared';
import { ApiRequestError, apiRequest, errorMessage, isApiRequestError } from './api';
import {
  addDays,
  formatCountdown,
  formatDayParam,
  formatFcfa,
  formatTime,
  plural,
  todayInDakar,
} from './format';
import { randomId } from './random';
import { SESSION_STORAGE_KEY, sessionStore } from './session';
import { apiError, mockApi } from '../test/api-mock';
import { signIn } from '../test/render';

describe('format', () => {
  it('affiche heures et jours en heure de Dakar', () => {
    expect(formatTime('2026-11-20T07:05:00.000Z')).toBe('07:05');
    expect(formatDayParam('2026-11-20')).toBe('vendredi 20 novembre');
    expect(todayInDakar(new Date('2026-11-20T23:59:00Z'))).toBe('2026-11-20');
  });

  it('formate les FCFA, les comptes à rebours et les pluriels', () => {
    expect(formatFcfa(4000)).toBe('4 000 FCFA');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(-3000)).toBe('0:00');
    expect(plural(1, 'place')).toBe('1 place');
    expect(plural(3, 'place')).toBe('3 places');
  });

  it('décale les jours, y compris en changeant de mois', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30');
  });
});

describe('randomId', () => {
  it('produit une clé d’idempotence acceptée par l’API, même sans crypto.randomUUID (http sur téléphone)', () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9-]{32,36}$/);
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(171) });
    expect(randomId()).toBe('ab'.repeat(16));
  });
});

describe('apiRequest', () => {
  const schema = authResponseSchema.shape.user;

  it('envoie le jeton et valide la réponse', async () => {
    signIn();
    const api = mockApi({
      'GET /auth/me': {
        body: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'a@b.sn',
          name: 'Awa',
          role: 'traveler',
        },
      },
    });

    const user = await apiRequest('/auth/me', schema);

    expect(user.name).toBe('Awa');
    expect(api.calls[0]!.headers.authorization).toBe('Bearer jeton-traveler');
  });

  it('transforme le format d’erreur de l’API en ApiRequestError', async () => {
    mockApi({ 'POST /x': apiError(409, 'SEAT_TAKEN', 'Cette place vient d’être prise.') });

    const error = await apiRequest('/x', null, { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: 'SEAT_TAKEN' });
    expect(isApiRequestError(error, 'SEAT_TAKEN')).toBe(true);
    expect(isApiRequestError(error, 'HOLD_LIMIT')).toBe(false);
    expect(errorMessage(error)).toBe('Cette place vient d’être prise.');
  });

  it('déconnecte sur un 401 quand un jeton était envoyé', async () => {
    signIn();
    mockApi({ 'GET /auth/me': apiError(401, 'UNAUTHENTICATED', 'Session expirée.') });

    await expect(apiRequest('/auth/me', schema)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(sessionStore.get()).toBeNull();
  });

  it('réseau coupé, réponse sans format, réponse invalide : messages lisibles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('/x', null)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oups', { status: 502 })));
    await expect(apiRequest('/x', null)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'pas-un-uuid' })));
    await expect(apiRequest('/x', schema)).rejects.toThrow('Réponse inattendue du serveur.');

    expect(errorMessage(new Error('bug'))).toBe('Une erreur inattendue est survenue.');
  });

  it('204 : pas de corps', async () => {
    mockApi({ 'DELETE /x': { status: 204 } });
    await expect(apiRequest('/x', null, { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('sessionStore', () => {
  it('garde la session dans localStorage et la relit', () => {
    signIn('controller');
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!).user.role).toBe('controller');

    sessionStore.load();
    expect(sessionStore.get()?.user.role).toBe('controller');
  });

  it('ignore une session expirée ou corrompue', () => {
    localStorage.setItem(SESSION_STORAGE_KEY, '{pas du json');
    sessionStore.load();
    expect(sessionStore.get()).toBeNull();

    signIn();
    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)!);
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...stored, expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    sessionStore.load();
    expect(sessionStore.get()).toBeNull();
  });

  it('se déconnecte seule à l’expiration du jeton', () => {
    vi.useFakeTimers();
    signIn();
    vi.advanceTimersByTime(3_600_000);
    expect(sessionStore.get()).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('suit une connexion faite dans un autre onglet', () => {
    signIn();
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    sessionStore.clear();
    localStorage.setItem(SESSION_STORAGE_KEY, stored!);
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));
    expect(sessionStore.get()?.user.name).toBe('Awa Diop');
  });
});
