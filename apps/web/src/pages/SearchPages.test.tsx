import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { addDays, todayInDakar } from '../lib/format';
import { apiError, mockApi } from '../test/api-mock';
import { TRIP_ID, renderApp } from '../test/render';

const tomorrow = addDays(todayInDakar(), 1);
const summary = (overrides = {}) => ({
  id: TRIP_ID,
  origin: 'Dakar',
  destination: 'Thiès',
  departureAt: `${tomorrow}T07:00:00.000Z`,
  priceFcfa: 2000,
  busName: 'Minibus 15 places',
  seatCount: 15,
  remainingSeats: 12,
  ...overrides,
});

describe('accueil', () => {
  it('recherche : mène aux résultats avec départ, arrivée et date', async () => {
    mockApi({ 'GET /trips': { body: { trips: [] } } });
    const { user } = renderApp('/');

    await user.selectOptions(screen.getByLabelText('Départ'), 'Thiès');
    await user.selectOptions(screen.getByLabelText('Arrivée'), 'Saint-Louis');
    await user.click(screen.getByRole('button', { name: 'Rechercher' }));

    const params = new URLSearchParams({ from: 'Thiès', to: 'Saint-Louis', date: todayInDakar() });
    expect(screen.getByTestId('location')).toHaveTextContent(`/trajets?${params}`);
  });

  it('inverse les villes ; refuse deux fois la même ville', async () => {
    mockApi({});
    const { user } = renderApp('/');

    await user.click(screen.getByRole('button', { name: 'Inverser départ et arrivée' }));
    expect(screen.getByLabelText('Départ')).toHaveValue('Thiès');
    expect(screen.getByLabelText('Arrivée')).toHaveValue('Dakar');

    await user.selectOptions(screen.getByLabelText('Arrivée'), 'Thiès');
    await user.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choisissez deux villes différentes.');
  });

  it('« Essayer en contrôleur » connecte au compte de démo et ouvre le contrôle', async () => {
    const api = mockApi({
      'POST /auth/demo': {
        body: {
          token: 'jeton',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          user: {
            id: '00000000-0000-4000-8000-000000000002',
            email: 'controleur@demo.test',
            name: 'Contrôleur',
            role: 'controller',
          },
        },
      },
    });
    const { user } = renderApp('/');

    await user.click(screen.getByRole('button', { name: 'Essayer en contrôleur' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/controle'));
    expect(api.callsTo('POST /auth/demo')[0]!.body).toEqual({ role: 'controller' });
    expect(await screen.findByText('Connecté en contrôleur de démo.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contrôle' })).toBeInTheDocument();
  });

  it('compte de démo indisponible : message d’erreur', async () => {
    mockApi({
      'POST /auth/demo': apiError(429, 'RATE_LIMITED', 'Trop de tentatives. Réessayez dans 30 s.'),
    });
    const { user } = renderApp('/');
    await user.click(screen.getByRole('button', { name: 'Essayer en voyageur' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives');
  });
});

describe('résultats', () => {
  const url = `/trajets?${new URLSearchParams({ from: 'Dakar', to: 'Thiès', date: tomorrow })}`;

  it('liste les départs avec heure, prix et places restantes', async () => {
    const api = mockApi({
      'GET /trips': {
        body: {
          trips: [
            summary(),
            summary({
              id: '44444444-4444-4444-8444-444444444444',
              departureAt: `${tomorrow}T18:00:00.000Z`,
              remainingSeats: 0,
            }),
          ],
        },
      },
    });
    renderApp(url);

    expect(screen.getByRole('status', { name: 'Chargement des départs' })).toBeInTheDocument();
    const links = await screen.findAllByRole('link', { name: /FCFA/ });
    expect(links[0]).toHaveTextContent('07:00');
    expect(links[0]).toHaveTextContent('2 000 FCFA');
    expect(links[0]).toHaveTextContent('12 places libres');
    expect(links[0]).toHaveAttribute('href', `/trajets/${TRIP_ID}`);
    expect(links[1]).toHaveTextContent('Complet');
    expect(Object.fromEntries(api.callsTo('GET /trips')[0]!.query)).toEqual({
      from: 'Dakar',
      to: 'Thiès',
      date: tomorrow,
    });
  });

  it('aucun départ : message et proposition d’une autre date', async () => {
    mockApi({ 'GET /trips': { body: { trips: [] } } });
    renderApp(url);

    expect(await screen.findByText('Aucun départ ce jour-là.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir le lendemain' })).toHaveAttribute(
      'href',
      `/trajets?${new URLSearchParams({ from: 'Dakar', to: 'Thiès', date: addDays(tomorrow, 1) })}`,
    );
    expect(screen.getByRole('link', { name: 'Jour précédent' })).toBeInTheDocument();
  });

  it('erreur de l’API : son message et Réessayer, qui relance la recherche', async () => {
    let calls = 0;
    mockApi({
      'GET /trips': () =>
        ++calls === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Base de données injoignable.')
          : { body: { trips: [] } },
    });
    const { user } = renderApp(url);

    expect(await screen.findByText('Base de données injoignable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Aucun départ ce jour-là.')).toBeInTheDocument();
  });

  it('recherche incomplète : retour à l’accueil, pas d’appel', async () => {
    const api = mockApi({});
    renderApp('/trajets?from=Dakar');
    expect(screen.getByText(/Recherche incomplète/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it('aujourd’hui : pas de jour précédent', async () => {
    mockApi({ 'GET /trips': { body: { trips: [] } } });
    renderApp(
      `/trajets?${new URLSearchParams({ from: 'Dakar', to: 'Thiès', date: todayInDakar() })}`,
    );
    await screen.findByText('Aucun départ ce jour-là.');
    expect(screen.queryByRole('link', { name: 'Jour précédent' })).not.toBeInTheDocument();
  });
});
