import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const uuid = z.uuid();

export interface TicketSigner {
  /** Code affiché en QR : base64url(ticketId) + "." + base64url(HMAC-SHA256(secret, ticketId)). */
  sign(ticketId: string): string;
  /** Identifiant du billet si le code est authentique, sinon null. Ne consulte pas la base. */
  verify(code: string): string | null;
}

/** Sans le secret du serveur, impossible de fabriquer un code valide : un faux billet est détecté hors ligne. */
export function createTicketSigner(secret: string): TicketSigner {
  const mac = (ticketId: string) => createHmac('sha256', secret).update(ticketId).digest();

  return {
    sign(ticketId) {
      return `${Buffer.from(ticketId).toString('base64url')}.${mac(ticketId).toString('base64url')}`;
    },

    verify(code) {
      const parts = code.split('.');
      if (parts.length !== 2) return null;
      const [encodedId, encodedSignature] = parts as [string, string];

      const ticketId = Buffer.from(encodedId, 'base64url').toString('utf8');
      if (!uuid.safeParse(ticketId).success) return null;
      const given = Buffer.from(encodedSignature, 'base64url');
      // Le décodage base64url de Node est tolérant : on n'accepte que l'écriture canonique du code.
      if (
        Buffer.from(ticketId).toString('base64url') !== encodedId ||
        given.toString('base64url') !== encodedSignature
      ) {
        return null;
      }

      // Comparaison en temps constant : un `===` répondrait plus vite quand les premiers octets diffèrent,
      // ce qui permettrait de deviner la signature octet par octet. timingSafeEqual exige deux tampons
      // de même longueur ; cette longueur (32 octets) n'a rien de secret.
      const expected = mac(ticketId);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      return ticketId;
    },
  };
}
