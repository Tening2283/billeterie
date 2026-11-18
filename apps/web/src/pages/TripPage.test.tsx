import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SeatStatus } from '@billetterie/shared';
import { apiError, mockApi } from '../test/api-mock';
import { fakeSocket } from '../test/fake-socket';
import { TRIP_ID, inMinutes, renderApp, seatList, signIn, tripDetail } from '../test/render';

const URL = `/trajets/${TRIP_ID}`;

function tripApi(seats: () => SeatStatus[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /trips/:id': { body: tripDetail() },
    'GET /trips/:id/seats': () => ({ body: { tripId: TRIP_ID, seats: seats() } }),
    ...extra,
  });
}

const seat = (n: number) => screen.findByRole('button', { name: new RegExp(`^Place ${n},`) });

describe('page du plan du car', () => {
  it('affiche un squelette, puis le plan et les infos du trajet', async () => {
    tripApi(() => seatList({ 4: { state: 'sold' } }));
    renderApp(URL);

    expect(screen.getByRole('status', { name: 'Chargement du plan du car' })).toBeInTheDocument();
    expect(await seat(4)).toHaveAccessibleName('Place 4, vendue');
    expect(screen.getByRole('heading', { name: 'Dakar → Thiès' })).toBeInTheDocument();
    expect(screen.getByText(/2 000 FCFA la place/)).toBeInTheDocument();
    expect(fakeSocket.sent).toContainEqual(['trip:join', TRIP_ID]);
  });

  it('visiteur non connecté : un clic invite à se connecter, sans appeler l’API', async () => {
    const api = tripApi(() => seatList());
    const { user } = renderApp(URL);

    await user.click(await seat(1));

    expect(
      await screen.findByText('Connectez-vous en voyageur pour choisir une place.'),
    ).toBeInTheDocument();
    expect(api.callsTo('POST /trips/:id/holds')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Essayer en voyageur' })).toBeInTheDocument();
  });

  it('clic sur une place libre : blocage, récapitulatif avec compte à rebours et total', async () => {
    signIn();
    const expiresAt = inMinutes(10);
    const api = tripApi(() => seatList(), {
      'POST /trips/:id/holds': (req) => ({
        status: 201,
        body: {
          tripId: TRIP_ID,
          seatNumber: (req.body as { seatNumber: number }).seatNumber,
          expiresAt,
        },
      }),
    });
    const { user } = renderApp(URL);

    await user.click(await seat(7));

    expect(await seat(7)).toHaveAccessibleName('Place 7, bloquée par vous');
    expect(api.callsTo('POST /trips/:id/holds')[0]!.body).toEqual({ seatNumber: 7 });
    const summary = screen.getByRole('complementary', { name: 'Récapitulatif' });
    expect(summary).toHaveTextContent('1 place : 7 · 2 000 FCFA');
    expect(within(summary).getByRole('timer')).toHaveTextContent(/^(10:00|9:5\d)$/);
    expect(within(summary).getByRole('link', { name: 'Continuer' })).toHaveAttribute(
      'href',
      `${URL}/passagers`,
    );
  });

  it('409 SEAT_TAKEN : toast « Cette place vient d’être prise » et plan rechargé', async () => {
    signIn();
    let takenByOther = false;
    const api = tripApi(
      () => seatList(takenByOther ? { 3: { state: 'held', expiresAt: inMinutes(9) } } : {}),
      {
        'POST /trips/:id/holds': () => {
          takenByOther = true;
          return apiError(409, 'SEAT_TAKEN', 'Cette place est déjà bloquée.');
        },
      },
    );
    const { user } = renderApp(URL);

    await user.click(await seat(3));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cette place vient d’être prise.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Place 3,/ })).toHaveAccessibleName(
        'Place 3, bloquée par un autre voyageur',
      ),
    );
    expect(api.callsTo('GET /trips/:id/seats')).toHaveLength(2);
  });

  it('409 HOLD_LIMIT : le message de l’API s’affiche', async () => {
    signIn();
    tripApi(() => seatList(), {
      'POST /trips/:id/holds': apiError(
        409,
        'HOLD_LIMIT',
        'Vous bloquez déjà 4 places sur ce trajet.',
      ),
    });
    const { user } = renderApp(URL);

    await user.click(await seat(1));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vous bloquez déjà 4 places');
  });

  it('au-delà de 4 places, le front refuse sans appeler l’API', async () => {
    signIn();
    const mine = { state: 'held' as const, heldByMe: true, expiresAt: inMinutes(8) };
    const api = tripApi(() => seatList({ 1: mine, 2: mine, 3: mine, 4: mine }));
    const { user } = renderApp(URL);

    await user.click(await seat(9));

    expect(await screen.findByRole('alert')).toHaveTextContent('4 places au plus par réservation.');
    expect(api.callsTo('POST /trips/:id/holds')).toHaveLength(0);
  });

  it('clic sur ma place : elle est relâchée', async () => {
    signIn();
    const api = tripApi(
      () => seatList({ 5: { state: 'held', heldByMe: true, expiresAt: inMinutes(5) } }),
      {
        'DELETE /trips/:id/holds/:seat': { status: 204 },
      },
    );
    const { user } = renderApp(URL);

    await user.click(await seat(5));

    await waitFor(async () => expect(await seat(5)).toHaveAccessibleName('Place 5, libre'));
    expect(api.callsTo(`DELETE /trips/${TRIP_ID}/holds/5`)).toHaveLength(1);
    expect(screen.queryByRole('complementary', { name: 'Récapitulatif' })).not.toBeInTheDocument();
  });

  it('relâche impossible (blocage déjà expiré) : message et rechargement', async () => {
    signIn();
    let expired = false;
    tripApi(
      () =>
        seatList(expired ? {} : { 5: { state: 'held', heldByMe: true, expiresAt: inMinutes(5) } }),
      {
        'DELETE /trips/:id/holds/:seat': () => {
          expired = true;
          return apiError(
            404,
            'NOT_FOUND',
            'Vous ne bloquez pas cette place (ou le blocage a expiré).',
          );
        },
      },
    );
    const { user } = renderApp(URL);

    await user.click(await seat(5));

    expect(await screen.findByRole('alert')).toHaveTextContent('le blocage a expiré');
    await waitFor(async () => expect(await seat(5)).toHaveAccessibleName('Place 5, libre'));
  });

  it('temps réel : seat:held, seat:released et seat:sold mettent le plan à jour sans recharger', async () => {
    const api = tripApi(() => seatList());
    renderApp(URL);
    await seat(1);

    act(() =>
      fakeSocket.serverEmit('seat:held', {
        tripId: TRIP_ID,
        seatNumber: 2,
        expiresAt: inMinutes(10),
      }),
    );
    expect(await seat(2)).toHaveAccessibleName('Place 2, bloquée par un autre voyageur');

    act(() => fakeSocket.serverEmit('seat:released', { tripId: TRIP_ID, seatNumber: 2 }));
    expect(await seat(2)).toHaveAccessibleName('Place 2, libre');

    act(() => fakeSocket.serverEmit('seat:sold', { tripId: TRIP_ID, seatNumbers: [8, 9] }));
    expect(await seat(9)).toHaveAccessibleName('Place 9, vendue');

    // Un événement d'un autre trajet est ignoré.
    act(() => fakeSocket.serverEmit('seat:sold', { tripId: 'autre', seatNumbers: [1] }));
    expect(await seat(1)).toHaveAccessibleName('Place 1, libre');
    expect(api.callsTo('GET /trips/:id/seats')).toHaveLength(1);
  });

  it('mon propre seat:held n’écrase pas « bloquée par moi »', async () => {
    signIn();
    tripApi(() => seatList({ 6: { state: 'held', heldByMe: true, expiresAt: inMinutes(9) } }));
    renderApp(URL);
    await seat(6);

    act(() =>
      fakeSocket.serverEmit('seat:held', {
        tripId: TRIP_ID,
        seatNumber: 6,
        expiresAt: inMinutes(9),
      }),
    );

    expect(await seat(6)).toHaveAccessibleName('Place 6, bloquée par vous');
  });

  it('socket coupé : pastille « Hors ligne » ; à la reconnexion, on rejoint la salle et on recharge', async () => {
    const api = tripApi(() => seatList());
    renderApp(URL);
    await seat(1);
    expect(screen.getByText('En direct')).toBeInTheDocument();

    act(() => fakeSocket.disconnect());
    expect(screen.getByText('Hors ligne, mises à jour en pause')).toBeInTheDocument();

    act(() => fakeSocket.reconnect());
    expect(screen.getByText('En direct')).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET /trips/:id/seats')).toHaveLength(2));
    expect(fakeSocket.sent.filter(([e]) => e === 'trip:join')).toHaveLength(2);
  });

  it('blocage expiré : message clair, place relâchée, plan rechargé', async () => {
    signIn();
    let expired = false;
    const api = tripApi(() =>
      seatList(
        expired
          ? {}
          : {
              2: {
                state: 'held',
                heldByMe: true,
                expiresAt: new Date(Date.now() + 300).toISOString(),
              },
            },
      ),
    );
    renderApp(URL);
    await seat(2);
    expired = true;

    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'Votre blocage de la place 2 a expiré : elle a été relâchée.',
    );
    await waitFor(async () => expect(await seat(2)).toHaveAccessibleName('Place 2, libre'));
    expect(api.callsTo('GET /trips/:id/seats').length).toBeGreaterThanOrEqual(2);
  });

  it('quitte la salle en quittant la page', async () => {
    tripApi(() => seatList());
    const { unmount } = renderApp(URL);
    await seat(1);
    unmount();
    expect(fakeSocket.sent).toContainEqual(['trip:leave', TRIP_ID]);
  });

  it('départ passé ou annulé : réservations fermées', async () => {
    signIn();
    mockApi({
      'GET /trips/:id': { body: tripDetail({ status: 'cancelled' }) },
      'GET /trips/:id/seats': { body: { tripId: TRIP_ID, seats: seatList() } },
    });
    renderApp(URL);
    expect(await screen.findByText('Ce départ est annulé.')).toBeInTheDocument();
  });

  it('trajet introuvable : message de l’API et bouton Réessayer', async () => {
    mockApi({
      'GET /trips/:id': apiError(404, 'NOT_FOUND', 'Ce trajet est introuvable.'),
      'GET /trips/:id/seats': apiError(404, 'NOT_FOUND', 'Ce trajet est introuvable.'),
    });
    renderApp(URL);
    expect(await screen.findByText('Ce trajet est introuvable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('compte contrôleur : ne peut pas réserver', async () => {
    signIn('controller');
    tripApi(() => seatList());
    renderApp(URL);
    expect(await screen.findByText(/Ce compte ne peut pas réserver/)).toBeInTheDocument();
  });
});
