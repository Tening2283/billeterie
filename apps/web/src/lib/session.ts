import { useSyncExternalStore } from 'react';
import { authResponseSchema, type AuthResponse } from '@billetterie/shared';

/**
 * Session du visiteur : le jeton JWT et l'utilisateur, gardés dans localStorage
 * (le front et l'API sont sur deux domaines : pas de cookie, voir le cahier des charges).
 * La session disparaît d'elle-même à l'expiration du jeton (1 h).
 */
export type Session = AuthResponse;

export const SESSION_STORAGE_KEY = 'billetterie.session';
/** setTimeout n'accepte pas plus de ~24,8 jours. */
const MAX_TIMEOUT_MS = 2_147_483_647;

type Listener = () => void;
const listeners = new Set<Listener>();
let current: Session | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function isExpired(session: Session, now = Date.now()) {
  return Date.parse(session.expiresAt) <= now;
}

function readStorage(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = authResponseSchema.safeParse(JSON.parse(raw));
    return parsed.success && !isExpired(parsed.data) ? parsed.data : null;
  } catch {
    return null; // stockage bloqué (navigation privée) ou contenu corrompu
  }
}

function writeStorage(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Sans stockage, la session vit seulement le temps de l'onglet.
  }
}

function update(session: Session | null) {
  clearTimeout(expiryTimer);
  current = session && !isExpired(session) ? session : null;
  writeStorage(current);
  if (current) {
    const delay = Math.min(Date.parse(current.expiresAt) - Date.now(), MAX_TIMEOUT_MS);
    expiryTimer = setTimeout(() => update(null), delay);
  }
  listeners.forEach((listener) => listener());
}

export const sessionStore = {
  get: (): Session | null => current,
  token: (): string | null => current?.token ?? null,
  set: (session: Session) => update(session),
  clear: () => {
    if (current) update(null);
  },
  /** Relit localStorage (au démarrage, et dans les tests). */
  load: () => update(readStorage()),
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

sessionStore.load();

// Connexion ou déconnexion dans un autre onglet.
window.addEventListener('storage', (event) => {
  if (event.key === SESSION_STORAGE_KEY) sessionStore.load();
});

export function useSession(): Session | null {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
}
