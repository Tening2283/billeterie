import type { TicketCodeResponse, VerifyTicketResponse } from '@billetterie/shared';
import { z } from 'zod';
import { AppError } from '../lib/app-error';
import type { Db } from '../lib/db';
import type { TicketSigner } from '../lib/ticket-codes';

const uuid = z.uuid();
const INVALID: VerifyTicketResponse = { result: 'invalid', ticket: null };

/**
 * Un billet reste utilisable jusqu'à 12 h après l'heure de départ (retards, longs trajets) ;
 * au-delà, ou si le départ a été annulé, il est refusé. Le contrôleur voit en plus le trajet et
 * l'heure affichés, pour repérer un billet d'un autre car.
 */
export const TICKET_VALID_AFTER_DEPARTURE_HOURS = 12;

export interface TicketService {
  /** Code signé d'un billet, réservé à son propriétaire (404 sinon, pour ne pas révéler qu'il existe). */
  codeFor(userId: string, ticketId: string): Promise<TicketCodeResponse>;
  /** Contrôle à la montée : « valide » une seule fois, puis « déjà utilisé ». */
  verify(code: string): Promise<VerifyTicketResponse>;
}

export function createTicketService({
  db,
  signer,
}: {
  db: Db;
  signer: TicketSigner;
}): TicketService {
  return {
    async codeFor(userId, ticketId) {
      const ticket = uuid.safeParse(ticketId).success
        ? await db.ticket.findFirst({
            where: { id: ticketId, booking: { userId } },
            select: { id: true },
          })
        : null;
      if (!ticket) throw new AppError(404, 'NOT_FOUND', 'Ce billet est introuvable.');
      return { ticketId: ticket.id, code: signer.sign(ticket.id) };
    },

    async verify(code) {
      // 1. Signature : sans le secret du serveur, impossible de fabriquer un code. Faux : « invalid ».
      const ticketId = signer.verify(code);
      if (!ticketId) return INVALID;

      // 2. Marquer le billet utilisé en UNE requête atomique : si deux contrôleurs scannent le même
      //    billet à la même seconde, PostgreSQL n'applique la condition status = 'valid' qu'une fois.
      //    Le départ doit aussi être maintenu et pas trop ancien (TICKET_VALID_AFTER_DEPARTURE_HOURS).
      const used = await db.$queryRaw<{ id: string }[]>`
        UPDATE tickets SET status = 'used', used_at = now()
        FROM trips
        WHERE tickets.id = ${ticketId}::uuid
          AND tickets.status = 'valid'
          AND trips.id = tickets.trip_id
          AND trips.status = 'scheduled'
          AND trips.departure_at > now() - make_interval(hours => ${TICKET_VALID_AFTER_DEPARTURE_HOURS}::int)
        RETURNING tickets.id`;

      const ticket = await db.ticket.findUnique({
        where: { id: ticketId },
        include: { trip: { include: { route: true, bus: true } } },
      });
      // Signature correcte mais billet absent (base remise à zéro…), annulé, ou pour un départ
      // annulé / passé depuis longtemps : refusé comme un faux billet.
      if (!ticket || ticket.status === 'cancelled') return INVALID;
      if (used.length === 0 && ticket.status === 'valid') return INVALID;

      const details = {
        id: ticket.id,
        seatNumber: ticket.seatNumber,
        passengerName: ticket.passengerName,
        usedAt: ticket.usedAt?.toISOString() ?? null,
        trip: {
          id: ticket.trip.id,
          origin: ticket.trip.route.origin,
          destination: ticket.trip.route.destination,
          departureAt: ticket.trip.departureAt.toISOString(),
          busName: ticket.trip.bus.name,
        },
      };
      // Une ligne modifiée : c'est ce scan qui a validé le billet. Zéro : il l'était déjà.
      return { result: used.length === 1 ? 'valid' : 'already_used', ticket: details };
    },
  };
}
