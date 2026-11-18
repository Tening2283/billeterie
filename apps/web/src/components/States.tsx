import type { ReactNode } from 'react';
import { errorMessage } from '../lib/api';

/** Erreur de l'API : son `message`, et un bouton Réessayer. */
export function ErrorState({
  error,
  onRetry,
  children,
}: {
  error: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
      <p className="font-medium">{errorMessage(error)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="btn-secondary">
            Réessayer
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** Bloc gris animé : jamais une page blanche pendant le chargement. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
  );
}

/** Squelette du plan du car, à la forme d'un car de 5 colonnes. */
export function SeatMapSkeleton() {
  return (
    <div role="status" aria-label="Chargement du plan du car" className="space-y-4">
      <Skeleton className="h-16" />
      <div className="grid grid-cols-6 gap-2 rounded-3xl border-2 border-slate-200 p-4">
        {Array.from({ length: 36 }, (_, i) =>
          i % 6 === 2 ? <span key={i} /> : <Skeleton key={i} className="h-12" />,
        )}
      </div>
    </div>
  );
}

export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}
