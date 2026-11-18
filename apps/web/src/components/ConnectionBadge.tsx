import { useSocketConnected } from '../hooks/useSocketConnected';

/** Pastille temps réel : « En direct » ou « Hors ligne, mises à jour en pause ». */
export function ConnectionBadge() {
  const connected = useSocketConnected();
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-600' : 'bg-slate-500'}`}
      />
      {connected ? 'En direct' : 'Hors ligne, mises à jour en pause'}
    </span>
  );
}
