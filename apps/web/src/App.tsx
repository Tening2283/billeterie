import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { RequireRole } from './components/RequireRole';
import { ApiRequestError } from './lib/api';
import { queryKeys } from './lib/endpoints';
import { sessionStore } from './lib/session';
import { ToastProvider } from './lib/toast';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { ControlPage } from './pages/ControlPage';
import { HomePage } from './pages/HomePage';
import { PassengersPage } from './pages/PassengersPage';
import { ResultsPage } from './pages/ResultsPage';
import { TicketsPage } from './pages/TicketsPage';
import { TripPage } from './pages/TripPage';

/** Relance automatique seulement si ça peut aider : réseau coupé ou erreur serveur. */
function shouldRetry(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false;
  return !(error instanceof ApiRequestError) || error.status === 0 || error.status >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

/** À chaque changement de compte, on oublie les données de l'ancien (billets, codes). */
function SessionCacheReset() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let userId = sessionStore.get()?.user.id;
    return sessionStore.subscribe(() => {
      const next = sessionStore.get()?.user.id;
      if (next === userId) return;
      userId = next;
      queryClient.removeQueries({ queryKey: queryKeys.bookings });
      queryClient.removeQueries({ queryKey: queryKeys.ticketCodes });
    });
  }, [queryClient]);
  return null;
}

/** Une erreur d'affichage sur une page ne bloque pas les autres : on repart à chaque navigation. */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}

function NotFoundPage() {
  return (
    <div className="card space-y-3">
      <h1 className="text-xl font-bold">Page introuvable</h1>
      <Link to="/" className="btn-primary">
        Retour à l’accueil
      </Link>
    </div>
  );
}

export function AppRoutes() {
  return (
    <RouteBoundary>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="trajets" element={<ResultsPage />} />
          <Route path="trajets/:id" element={<TripPage />} />
          <Route
            path="trajets/:id/passagers"
            element={
              <RequireRole roles={['traveler']}>
                <PassengersPage />
              </RequireRole>
            }
          />
          <Route
            path="billets"
            element={
              <RequireRole roles={['traveler']}>
                <TicketsPage />
              </RequireRole>
            }
          />
          <Route
            path="controle"
            element={
              <RequireRole roles={['controller', 'admin']}>
                <ControlPage />
              </RequireRole>
            }
          />
          <Route path="connexion" element={<LoginPage />} />
          <Route path="inscription" element={<RegisterPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </RouteBoundary>
  );
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionCacheReset />
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  );
}
