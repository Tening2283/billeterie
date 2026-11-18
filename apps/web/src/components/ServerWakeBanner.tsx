import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/config';

/** Au-delà, on considère que le serveur gratuit (Render) sort de veille. */
export const SLOW_AFTER_MS = 3000;
const RETRY_AFTER_MS = 3000;

/**
 * Au démarrage, appelle /health. S'il ne répond pas en 3 s : bandeau « le serveur se réveille ».
 * Le bandeau disparaît dès la première réponse, quelle qu'elle soit.
 */
export function ServerWakeBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let done = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const slowTimer = setTimeout(() => setWaking(true), SLOW_AFTER_MS);

    const ping = () => {
      fetch(`${API_BASE}/health`, { signal: controller.signal })
        .then(() => {
          done = true;
          clearTimeout(slowTimer);
          setWaking(false);
        })
        .catch(() => {
          // Réseau coupé ou serveur pas encore prêt : on réessaie tant que la page est ouverte.
          if (!done && !controller.signal.aborted) retryTimer = setTimeout(ping, RETRY_AFTER_MS);
        });
    };
    ping();

    return () => {
      controller.abort();
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
    };
  }, []);

  if (!waking) return null;
  return (
    <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      <span aria-hidden="true">☕ </span>
      Le serveur gratuit se réveille, environ 50 secondes…
    </div>
  );
}
