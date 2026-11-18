import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Dernier filet : une erreur de rendu affiche un message et un bouton, pas une page blanche. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur d’affichage', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-6">
        <h2 className="text-lg font-semibold text-red-900">Une erreur inattendue est survenue</h2>
        <p className="mt-2 text-sm text-red-800">
          La page n’a pas pu s’afficher. Rechargez-la ; si le problème continue, revenez à
          l’accueil.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
          <a href="/" className="btn-secondary">
            Accueil
          </a>
        </div>
      </div>
    );
  }
}
