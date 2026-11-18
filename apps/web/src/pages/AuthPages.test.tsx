import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sessionStore } from '../lib/session';
import { apiError, mockApi } from '../test/api-mock';
import { renderApp } from '../test/render';

const authBody = (role = 'traveler', name = 'Awa Diop') => ({
  token: 'jeton',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'awa@example.com', name, role },
});

describe('connexion', () => {
  it('valide le formulaire avec le schéma partagé avant tout appel', async () => {
    const api = mockApi({});
    const { user } = renderApp('/connexion');

    await user.type(screen.getByLabelText('E-mail'), 'pas-un-email');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(screen.getByText('E-mail invalide')).toBeInTheDocument();
    expect(screen.getByText('Mot de passe obligatoire')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls).toHaveLength(0);
  });

  it('identifiants refusés : message de l’API', async () => {
    mockApi({
      'POST /auth/login': apiError(401, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect.'),
    });
    const { user } = renderApp('/connexion');

    await user.type(screen.getByLabelText('E-mail'), 'awa@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'mauvais');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByText('E-mail ou mot de passe incorrect.')).toBeInTheDocument();
  });

  it('connecte et revient à la page demandée (chemin interne seulement)', async () => {
    const api = mockApi({
      'POST /auth/login': { body: authBody() },
      'GET /bookings/me': { body: { bookings: [] } },
    });
    const { user } = renderApp(`/connexion?next=${encodeURIComponent('/billets')}`);

    await user.type(screen.getByLabelText('E-mail'), '  Awa@Example.com ');
    await user.type(screen.getByLabelText('Mot de passe'), 'motdepasse');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/billets'));
    expect(api.callsTo('POST /auth/login')[0]!.body).toEqual({
      email: 'awa@example.com',
      password: 'motdepasse',
    });
    expect(sessionStore.get()?.user.name).toBe('Awa Diop');
    expect(screen.getByText('Bonjour Awa Diop !')).toBeInTheDocument();
  });

  it('ignore une redirection vers un autre site', async () => {
    mockApi({ 'POST /auth/login': { body: authBody('controller') } });
    const { user } = renderApp(`/connexion?next=${encodeURIComponent('//evil.example')}`);

    await user.type(screen.getByLabelText('E-mail'), 'c@example.com');
    await user.type(screen.getByLabelText('Mot de passe'), 'motdepasse');
    await user.click(screen.getByRole('button', { name: 'Se connecter' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/controle$/));
  });

  it('compte de démo depuis la page de connexion', async () => {
    mockApi({ 'POST /auth/demo': { body: authBody('traveler', 'Voyageur démo') } });
    const { user } = renderApp('/connexion');
    await user.click(screen.getByRole('button', { name: 'Voyageur de démo' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(screen.getByRole('link', { name: 'Mes billets' })).toBeInTheDocument();
  });
});

describe('inscription', () => {
  it('valide nom, e-mail et mot de passe', async () => {
    mockApi({});
    const { user } = renderApp('/inscription');

    await user.type(screen.getByLabelText('Nom'), 'A');
    await user.type(screen.getByLabelText('Mot de passe (8 caractères minimum)'), 'court');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(screen.getAllByText('Au moins 2 caractères')).toHaveLength(1);
    expect(screen.getByText('Au moins 8 caractères')).toBeInTheDocument();
  });

  it('crée le compte et connecte', async () => {
    const api = mockApi({
      'POST /auth/register': { status: 201, body: authBody('traveler', 'Moussa Fall') },
    });
    const { user } = renderApp('/inscription');

    await user.type(screen.getByLabelText('Nom'), 'Moussa Fall');
    await user.type(screen.getByLabelText('E-mail'), 'moussa@example.com');
    await user.type(screen.getByLabelText('Mot de passe (8 caractères minimum)'), 'motdepasse');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect(await screen.findByText('Bienvenue Moussa Fall !')).toBeInTheDocument();
    expect(api.callsTo('POST /auth/register')[0]!.body).toEqual({
      name: 'Moussa Fall',
      email: 'moussa@example.com',
      password: 'motdepasse',
    });
  });

  it('e-mail déjà pris : message de l’API', async () => {
    mockApi({
      'POST /auth/register': apiError(409, 'EMAIL_TAKEN', 'Un compte existe déjà avec cet e-mail.'),
    });
    const { user } = renderApp('/inscription');
    await user.type(screen.getByLabelText('Nom'), 'Moussa Fall');
    await user.type(screen.getByLabelText('E-mail'), 'moussa@example.com');
    await user.type(screen.getByLabelText('Mot de passe (8 caractères minimum)'), 'motdepasse');
    await user.click(screen.getByRole('button', { name: 'Créer mon compte' }));
    expect(await screen.findByText('Un compte existe déjà avec cet e-mail.')).toBeInTheDocument();
  });
});
