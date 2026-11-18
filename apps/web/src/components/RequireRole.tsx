import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import type { Role } from '@billetterie/shared';
import { useSession } from '../lib/session';

/** Page réservée : sans session, direction la connexion (avec retour) ; mauvais rôle, message. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/connexion?next=${next}`} replace />;
  }
  if (!roles.includes(session.user.role)) {
    return (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-medium text-amber-900">
          Cette page n’est pas accessible avec ce compte.
        </p>
        <p className="mt-1 text-sm text-amber-800">
          {roles.includes('traveler')
            ? 'Elle est réservée aux voyageurs.'
            : 'Elle est réservée aux contrôleurs.'}
        </p>
        <Link to="/" className="btn-secondary mt-3">
          Retour à l’accueil
        </Link>
      </div>
    );
  }
  return children;
}

/** Destination après connexion : seulement un chemin interne (pas de redirection ouverte). */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}
