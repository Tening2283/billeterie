import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ticketCodeResponseSchema, verifyTicketResponseSchema } from '@billetterie/shared';
import { createTicketSigner } from '../src/lib/ticket-codes';
import { createTrip, resetDb, sellSeats, testDb } from './db';
import { authAs, buildTestApp, testSigner } from './helpers';

const app = buildTestApp();

beforeEach(resetDb);

async function ticketOf(userId?: string, status: 'valid' | 'used' | 'cancelled' = 'valid') {
  const trip = await createTrip();
  const booking = await sellSeats(trip.id, [7], status, userId);
  return { trip, ticket: booking.tickets[0]! };
}

/** Scan par un contrôleur (ou un admin) ; vérifie le code HTTP attendu (200 par défaut). */
async function verify(
  code: unknown,
  expectedStatus = 200,
  role: 'controller' | 'admin' = 'controller',
) {
  const { header } = await authAs(role);
  return request(app)
    .post('/api/v1/tickets/verify')
    .set('Authorization', header)
    .send({ code })
    .expect(expectedStatus);
}

describe('GET /api/v1/tickets/:id/code', () => {
  it('200 : le propriétaire obtient un code signé, authentique', async () => {
    const { user, header } = await authAs();
    const { ticket } = await ticketOf(user.id);

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/code`)
      .set('Authorization', header)
      .expect(200);

    const body = ticketCodeResponseSchema.parse(res.body);
    expect(body.ticketId).toBe(ticket.id);
    expect(testSigner.verify(body.code)).toBe(ticket.id);
  });

  it('404 pour le billet d’un autre voyageur (on ne révèle pas qu’il existe)', async () => {
    const { ticket } = await ticketOf();

    const res = await request(app)
      .get(`/api/v1/tickets/${ticket.id}/code`)
      .set('Authorization', (await authAs()).header)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404 pour un billet inconnu ou un identifiant mal formé ; 401 sans jeton', async () => {
    const { header } = await authAs();

    for (const id of ['00000000-0000-4000-8000-000000000000', 'pas-un-uuid']) {
      await request(app).get(`/api/v1/tickets/${id}/code`).set('Authorization', header).expect(404);
    }
    await request(app).get('/api/v1/tickets/00000000-0000-4000-8000-000000000000/code').expect(401);
  });
});

describe('POST /api/v1/tickets/verify', () => {
  it('« valid » au premier scan : le billet passe à utilisé, avec les infos pour le contrôleur', async () => {
    const { trip, ticket } = await ticketOf();

    const res = await verify(testSigner.sign(ticket.id));

    const body = verifyTicketResponseSchema.parse(res.body);
    expect(body.result).toBe('valid');
    expect(body.ticket).toMatchObject({
      id: ticket.id,
      seatNumber: 7,
      passengerName: 'Passager 7',
      trip: { id: trip.id, origin: 'Dakar', destination: 'Thiès' },
    });
    const stored = await testDb.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe('used');
    expect(stored.usedAt).not.toBeNull();
    expect(body.ticket?.usedAt).toBe(stored.usedAt?.toISOString());
  });

  it('« already_used » au second scan, avec l’heure du premier', async () => {
    const { ticket } = await ticketOf();
    const first = await verify(testSigner.sign(ticket.id));

    const second = await verify(testSigner.sign(ticket.id));

    expect(second.body.result).toBe('already_used');
    expect(second.body.ticket.usedAt).toBe(first.body.ticket.usedAt);
  });

  it('« invalid » pour un code falsifié, et le vrai billet reste intact', async () => {
    const { ticket } = await ticketOf();
    const forged = createTicketSigner('un-autre-secret-de-plus-de-32-caracteres!!').sign(ticket.id);

    for (const code of [forged, `${testSigner.sign(ticket.id)}x`, 'n-importe-quoi', 'a.b']) {
      const res = await verify(code);
      expect(res.body).toEqual({ result: 'invalid', ticket: null });
    }
    const stored = await testDb.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.status).toBe('valid');
  });

  it('« invalid » pour un billet annulé, ou signé mais absent de la base', async () => {
    const { ticket } = await ticketOf(undefined, 'cancelled');

    expect((await verify(testSigner.sign(ticket.id))).body.result).toBe('invalid');
    expect((await verify(testSigner.sign('00000000-0000-4000-8000-000000000000'))).body).toEqual({
      result: 'invalid',
      ticket: null,
    });
  });

  it.each([
    ['départ annulé', { status: 'cancelled' as const }, 'invalid'],
    ['départ passé depuis 13 h', { departureAt: new Date(Date.now() - 13 * 3_600_000) }, 'invalid'],
    [
      'départ passé depuis 2 h (retard)',
      { departureAt: new Date(Date.now() - 2 * 3_600_000) },
      'valid',
    ],
  ])('%s : « %s »', async (_label, tripOptions, expected) => {
    const trip = await createTrip(tripOptions);
    const { tickets } = await sellSeats(trip.id, [4]);

    const res = await verify(testSigner.sign(tickets[0]!.id));

    expect(res.body.result).toBe(expected);
    const stored = await testDb.ticket.findUniqueOrThrow({ where: { id: tickets[0]!.id } });
    expect(stored.status).toBe(expected === 'valid' ? 'used' : 'valid'); // refusé : billet intact
  });

  it('un admin peut aussi contrôler', async () => {
    const { ticket } = await ticketOf();
    expect((await verify(testSigner.sign(ticket.id), 200, 'admin')).body.result).toBe('valid');
  });

  it('401 sans jeton, 403 pour un voyageur, 400 sans code', async () => {
    const { ticket } = await ticketOf();
    const code = testSigner.sign(ticket.id);

    await request(app).post('/api/v1/tickets/verify').send({ code }).expect(401);
    await request(app)
      .post('/api/v1/tickets/verify')
      .set('Authorization', (await authAs('traveler')).header)
      .send({ code })
      .expect(403);
    await verify(undefined, 400);
  });
});
