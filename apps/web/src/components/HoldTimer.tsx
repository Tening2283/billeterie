import { useNow } from '../hooks/useNow';
import { formatCountdown } from '../lib/format';

/** Compte à rebours jusqu'à `expiresAt` ; passe en rouge dans la dernière minute. */
export function HoldTimer({ expiresAt }: { expiresAt: string }) {
  const now = useNow();
  const remaining = Date.parse(expiresAt) - now;
  const urgent = remaining < 60_000;

  return (
    <span
      className={`font-mono font-semibold tabular-nums ${urgent ? 'text-red-700' : 'text-sky-800'}`}
      aria-label={`Temps restant : ${formatCountdown(remaining)}`}
      role="timer"
    >
      {formatCountdown(remaining)}
    </span>
  );
}
