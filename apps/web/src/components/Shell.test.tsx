import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ErrorBoundary } from './ErrorBoundary';
import { SLOW_AFTER_MS, ServerWakeBanner } from './ServerWakeBanner';
import { mockApi } from '../test/api-mock';
import { renderApp, signIn } from '../test/render';

describe('bandeau de réveil du serveur', () => {
  it('apparaît si /health met plus de 3 s, disparaît à la réponse', async () => {
    vi.useFakeTimers();
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    render(<ServerWakeBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Le serveur gratuit se réveille, environ 50 secondes',
    );

    await act(async () => answer(new Response('{}')));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('réessaie tant que le serveur ne répond pas', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    render(<ServerWakeBanner />);

    await act(async () => vi.advanceTimersByTimeAsync(SLOW_AFTER_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('serveur rapide : jamais de bandeau', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    render(<ServerWakeBanner />);
    await act(async () => vi.advanceTimersByTimeAsync(SLOW_AFTER_MS * 2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('une erreur de rendu affiche un message et un bouton, pas une page blanche', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      throw new Error('bug');
    };
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Une erreur inattendue est survenue');
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeInTheDocument();
  });
});

describe('mise en page', () => {
  it('l’appli démarre sur l’accueil', () => {
    mockApi({});
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Billetterie de cars' })).toBeInTheDocument();
  });

  it('déconnexion : retour à l’accueil, menu de visiteur', async () => {
    signIn('traveler');
    mockApi({ 'GET /bookings/me': { body: { bookings: [] } } });
    const { user } = renderApp('/billets');

    await user.click(screen.getByRole('button', { name: 'Déconnexion' }));

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(screen.getByText('Vous êtes déconnecté.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion' })).toBeInTheDocument();
  });

  it('page inconnue', () => {
    mockApi({});
    renderApp('/nulle-part');
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument();
  });

  it('un toast se ferme seul, ou par son bouton', async () => {
    mockApi({});
    signIn();
    const { user } = renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Déconnexion' }));
    await user.click(screen.getByRole('button', { name: 'Fermer la notification' }));
    expect(screen.queryByText('Vous êtes déconnecté.')).not.toBeInTheDocument();
  });
});
