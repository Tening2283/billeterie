import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from '../test/api-mock';
import { TRIP_ID, renderApp, signIn, tripDetail } from '../test/render';

const trip = {
  id: TRIP_ID,
  origin: 'Dakar',
  destination: 'Thiès',
  departureAt: tripDetail().departureAt,
  busName: 'Minibus 15 places',
};
const ticket = (
  n: number,
  status: 'valid' | 'used' | 'cancelled',
  usedAt: string | null = null,
) => ({
  id: `33333333-3333-4333-8333-0000000000${String(n).padStart(2, '0')}`,
  seatNumber: n,
  passengerName: `Passager ${n}`,
  status,
  usedAt,
});

describe('Mes billets', () => {
  it('un QR code par billet valide, et le statut de chacun', async () => {
    signIn();
    const api = mockApi({
      'GET /bookings/me': {
        body: {
          bookings: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              status: 'confirmed',
              totalFcfa: 6000,
              createdAt: new Date().toISOString(),
              trip,
              tickets: [
                ticket(3, 'valid'),
                ticket(4, 'used', '2026-11-18T07:02:00.000Z'),
                ticket(5, 'cancelled'),
              ],
            },
          ],
        },
      },
      'GET /tickets/:id/code': (req) => ({
        body: { ticketId: req.path.split('/')[2], code: 'AAAA.BBBB' },
      }),
    });
    const { user } = renderApp('/billets');

    expect(screen.getByRole('status', { name: 'Chargement des billets' })).toBeInTheDocument();
    const qr = await screen.findByRole('img', { name: 'QR code du billet, place 3' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getAllByRole('img')).toHaveLength(1); // pas de QR pour un billet utilisé ou annulé

    const section = screen.getByRole('region', { name: 'Réservation Dakar → Thiès' });
    expect(within(section).getByText('✓ Valide')).toBeInTheDocument();
    expect(within(section).getByText('● Utilisé')).toBeInTheDocument();
    expect(within(section).getByText('Contrôlé à 07:02.')).toBeInTheDocument();
    expect(within(section).getByText('✕ Annulé')).toBeInTheDocument();
    expect(section).toHaveTextContent('6 000 FCFA');

    await user.click(screen.getByText('Code du billet (sans caméra)'));
    expect(screen.getByText('AAAA.BBBB')).toBeInTheDocument();
    expect(api.callsTo('GET /tickets/:id/code')).toHaveLength(1);
  });

  it('aucun billet : lien vers la recherche', async () => {
    signIn();
    mockApi({ 'GET /bookings/me': { body: { bookings: [] } } });
    renderApp('/billets');
    expect(await screen.findByText('Vous n’avez pas encore de billet.')).toBeInTheDocument();
  });

  it('QR indisponible : Réessayer', async () => {
    signIn();
    mockApi({
      'GET /bookings/me': {
        body: {
          bookings: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              status: 'confirmed',
              totalFcfa: 2000,
              createdAt: new Date().toISOString(),
              trip,
              tickets: [ticket(3, 'valid')],
            },
          ],
        },
      },
      'GET /tickets/:id/code': apiError(404, 'NOT_FOUND', 'Billet introuvable.'),
    });
    renderApp('/billets');
    expect(await screen.findByText('QR code indisponible.')).toBeInTheDocument();
  });

  it('erreur de chargement : message de l’API', async () => {
    signIn();
    mockApi({ 'GET /bookings/me': apiError(500, 'INTERNAL_ERROR', 'Erreur interne du serveur.') });
    renderApp('/billets');
    expect(await screen.findByText('Erreur interne du serveur.')).toBeInTheDocument();
  });

  it('réservé aux voyageurs', async () => {
    signIn('controller');
    mockApi({});
    renderApp('/billets');
    expect(screen.getByText('Cette page n’est pas accessible avec ce compte.')).toBeInTheDocument();
    expect(screen.getByText('Elle est réservée aux voyageurs.')).toBeInTheDocument();
  });
});

describe('Contrôle', () => {
  const verified = {
    id: '33333333-3333-4333-8333-000000000003',
    seatNumber: 3,
    passengerName: 'Awa Diop',
    usedAt: '2026-11-18T07:02:00.000Z',
    trip,
  };

  it.each([
    ['valid', { result: 'valid', ticket: verified }, 'Billet valide'],
    ['already_used', { result: 'already_used', ticket: verified }, 'Déjà utilisé'],
    ['invalid', { result: 'invalid', ticket: null }, 'Faux billet'],
  ])('code collé → « %s » affiché en grand', async (_result, body, title) => {
    signIn('controller');
    const api = mockApi({ 'POST /tickets/verify': { body } });
    const { user } = renderApp('/controle');

    await user.type(screen.getByLabelText('Ou collez le code du billet'), '  AAAA.BBBB ');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));

    const panel = await screen.findByRole('status', { name: 'Résultat du contrôle' });
    expect(panel).toHaveTextContent(title);
    expect(api.callsTo('POST /tickets/verify')[0]!.body).toEqual({ code: 'AAAA.BBBB' });
    if (body.ticket) {
      expect(panel).toHaveTextContent('Awa Diop');
      expect(panel).toHaveTextContent('Dakar → Thiès');
    }

    await user.click(screen.getByRole('button', { name: 'Contrôler le billet suivant' }));
    expect(screen.getByLabelText('Ou collez le code du billet')).toHaveValue('');
  });

  it('« Déjà utilisé » indique l’heure du premier contrôle', async () => {
    signIn('controller');
    mockApi({ 'POST /tickets/verify': { body: { result: 'already_used', ticket: verified } } });
    const { user } = renderApp('/controle');
    await user.type(screen.getByLabelText('Ou collez le code du billet'), 'x.y');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText(/à 07:02/)).toBeInTheDocument();
  });

  it('erreur réseau : message et Réessayer', async () => {
    signIn('admin');
    let calls = 0;
    mockApi({
      'POST /tickets/verify': () =>
        ++calls === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Service indisponible.')
          : { body: { result: 'invalid', ticket: null } },
    });
    const { user } = renderApp('/controle');
    await user.type(screen.getByLabelText('Ou collez le code du billet'), 'x.y');
    await user.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('Service indisponible.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Faux billet')).toBeInTheDocument();
  });

  it('caméra hors https : message clair, le code collé reste possible', async () => {
    signIn('controller');
    mockApi({});
    const { user } = renderApp('/controle');
    await user.click(screen.getByRole('button', { name: /Scanner avec la caméra/ }));
    expect(await screen.findByText(/La caméra n’est disponible qu’en https/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fermer la caméra' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Scanner avec la caméra/ })).toBeInTheDocument(),
    );
  });

  it('réservé aux contrôleurs', () => {
    signIn('traveler');
    mockApi({});
    renderApp('/controle');
    expect(screen.getByText('Elle est réservée aux contrôleurs.')).toBeInTheDocument();
  });
});
