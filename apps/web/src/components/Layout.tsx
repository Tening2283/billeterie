import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { sessionStore, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { ServerWakeBanner } from './ServerWakeBanner';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2 py-1.5 ${isActive ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'}`;

export function Layout() {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const role = session?.user.role;

  const logout = () => {
    // D'abord quitter la page (une page réservée renverrait sinon vers la connexion),
    // puis oublier la session : React Router applique la navigation de façon asynchrone.
    void Promise.resolve(navigate('/')).then(() => {
      sessionStore.clear();
      toast.show('Vous êtes déconnecté.');
    });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <ServerWakeBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <Link to="/" className="mr-auto py-1 text-lg font-bold text-slate-900">
            <span aria-hidden="true">🚌 </span>Billetterie
          </Link>
          <nav aria-label="Navigation principale" className="flex items-center gap-1 text-sm">
            {role === 'traveler' && (
              <NavLink to="/billets" className={navClass}>
                Mes billets
              </NavLink>
            )}
            {(role === 'controller' || role === 'admin') && (
              <NavLink to="/controle" className={navClass}>
                Contrôle
              </NavLink>
            )}
            {session ? (
              <>
                <span className="hidden max-w-32 truncate text-slate-500 sm:inline">
                  {session.user.name}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-md px-2 py-1.5 text-slate-600 hover:text-slate-900"
                >
                  Déconnexion
                </button>
              </>
            ) : (
              <NavLink to="/connexion" className={navClass}>
                Connexion
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <Outlet />
      </main>
      <footer className="px-4 py-4 text-center text-xs text-slate-500">
        Projet de démonstration — aucun paiement réel. Heures affichées en heure de Dakar.
      </footer>
    </div>
  );
}
