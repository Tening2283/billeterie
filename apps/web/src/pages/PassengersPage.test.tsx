import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, type MockReply } from '../test/api-mock';
import { TRIP_ID, inMinutes, renderApp, seatList, signIn, tripDetail } from '../test/render';

const URL = `/trajets/${TRIP_ID}/passagers`;
const mine = { state: 'held' as const, heldByMe: true, expiresAt: inMinutes(8) };

function booking(seats: number[]) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'confirmed',
    totalFcfa: seats.length * 2000,
    createdAt: new Date().toISOString(),
    trip: {
      id: TRIP_ID,
      origin: 'Dakar',
      destination: 'Thiès',
      departureAt: tripDetail().departureAt,
      busName: 'Minibus',
    },
    tickets: seats.map((n, i) => ({
      id: `33333333-3333-4333-8333-00000000000${i}`,
      seatNumber: n,
      passengerName: `Passager ${n}`,
      status: 'valid',
      usedAt: null,
    })),
  };
}

function passengersApi(onBook: () => MockReply) {
  return mockApi({
    'GET /trips/:id': { body: tripDetail() },
    'GET /trips/:id/seats': { body: { tripId: TRIP_ID, seats: seatList({ 3: mine, 7: mine }) } },
    'POST /bookings': onBook,
    'GET /bookings/me': { body: { bookings: [] } },
  });
}

describe('page Passagers', () => {
  it('sans session : redirige vers la connexion, avec retour prévu', async () => {
    mockApi({});
    renderApp(URL);
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/connexion?next=${encodeURIComponent(URL)}`,
    );
  });

  it('un nom par place, le premier prérempli ; validation avec le schéma partagé', async () => {
    signIn();
    const api = passengersApi(() => ({ status: 201, body: booking([3, 7]) }));
    const { user } = renderApp(URL);

    const first = await screen.findByLabelText('Nom du passager — place 3');
    const second = screen.getByLabelText('Nom du passager — place 7');
    expect(first).toHaveValue('Awa Diop');
    expect(second).toHaveValue('');
    expect(screen.getByText('4 000 FCFA')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Au moins 2 caractères')).toBeInTheDocument();
    expect(api.callsTo('POST /bookings')).toHaveLength(0);
  });

  it('confirme avec une clé d’idempotence, puis mène à Mes billets', async () => {
    signIn();
    const api = passengersApi(() => ({ status: 201, body: booking([3, 7]) }));
    const { user } = renderApp(URL);

    await user.type(await screen.findByLabelText('Nom du passager — place 7'), 'Moussa Fall');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/billets'));
    expect(
      await screen.findByText('Réservation confirmée : vos billets sont prêts.'),
    ).toBeInTheDocument();
    const [request] = api.callsTo('POST /bookings');
    expect(request!.body).toEqual({
      tripId: TRIP_ID,
      passengers: [
        { seatNumber: 3, passengerName: 'Awa Diop' },
        { seatNumber: 7, passengerName: 'Moussa Fall' },
      ],
    });
    expect(request!.headers['idempotency-key']).toMatch(/^[A-Za-z0-9-]{32,36}$/);
  });

  it('après une coupure réseau, « Réessayer » renvoie la même clé (pas de double réservation)', async () => {
    signIn();
    let attempts = 0;
    const api = passengersApi(() => {
      attempts += 1;
      return attempts === 1
        ? apiError(503, 'SERVICE_UNAVAILABLE', 'Service momentanément indisponible.')
        : { status: 201, body: booking([3, 7]) };
    });
    const { user } = renderApp(URL);

    await user.type(await screen.findByLabelText('Nom du passager — place 7'), 'Moussa Fall');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Service momentanément indisponible.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/billets'));

    const [first, second] = api.callsTo('POST /bookings');
    expect(second!.headers['idempotency-key']).toBe(first!.headers['idempotency-key']);
  });

  it('noms modifiés après une erreur : nouvelle clé', async () => {
    signIn();
    const api = passengersApi(() => apiError(400, 'VALIDATION_ERROR', 'Nom refusé.'));
    const { user } = renderApp(URL);

    const field = await screen.findByLabelText('Nom du passager — place 7');
    await user.type(field, 'Moussa');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    await screen.findByText('Nom refusé.');
    await user.type(field, ' Fall');
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => expect(api.callsTo('POST /bookings')).toHaveLength(2));
    const [first, second] = api.callsTo('POST /bookings');
    expect(second!.headers['idempotency-key']).not.toBe(first!.headers['idempotency-key']);
  });

  it('409 HOLD_EXPIRED : message et retour au plan', async () => {
    signIn();
    passengersApi(() =>
      apiError(409, 'HOLD_EXPIRED', 'Votre blocage a expiré : choisissez à nouveau vos places.'),
    );
    const { user } = renderApp(URL);

    await user.type(await screen.findByLabelText('Nom du passager — place 7'), 'Moussa Fall');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByText(/Votre blocage a expiré/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/trajets/${TRIP_ID}`),
    );
  });

  it('aucune place bloquée : lien vers le plan', async () => {
    signIn();
    mockApi({
      'GET /trips/:id': { body: tripDetail() },
      'GET /trips/:id/seats': { body: { tripId: TRIP_ID, seats: seatList() } },
    });
    renderApp(URL);
    expect(
      await screen.findByText('Vous n’avez aucune place bloquée sur ce trajet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retour au plan du car' })).toHaveAttribute(
      'href',
      `/trajets/${TRIP_ID}`,
    );
  });

  it('erreur de chargement : message et Réessayer', async () => {
    signIn();
    mockApi({
      'GET /trips/:id': apiError(500, 'INTERNAL_ERROR', 'Erreur interne.'),
      'GET /trips/:id/seats': { body: { tripId: TRIP_ID, seats: seatList() } },
    });
    renderApp(URL);
    expect(await screen.findByText('Erreur interne.')).toBeInTheDocument();
  });
});
