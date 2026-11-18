import { useEffect, useState } from 'react';

/** Heure courante, rafraîchie toutes les `intervalMs` : pour les comptes à rebours. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
