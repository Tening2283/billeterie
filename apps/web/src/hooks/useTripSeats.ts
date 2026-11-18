import { useQuery } from '@tanstack/react-query';
import type { SeatStatus } from '@billetterie/shared';
import { api, queryKeys } from '../lib/endpoints';
import { useSession } from '../lib/session';

/** Trajet + places (selon le visiteur connecté) ; mes places bloquées triées par numéro. */
export function useTripSeats(tripId: string) {
  const session = useSession();
  const seatsKey = queryKeys.seats(tripId, session?.user.id);

  const trip = useQuery({ queryKey: queryKeys.trip(tripId), queryFn: () => api.trip(tripId) });
  const seats = useQuery({ queryKey: seatsKey, queryFn: () => api.seats(tripId) });

  const mySeats: SeatStatus[] = (seats.data?.seats ?? [])
    .filter((s) => s.state === 'held' && s.heldByMe)
    .sort((a, b) => a.seatNumber - b.seatNumber);

  // Échéance la plus proche : c'est elle qui compte pour l'affichage du compte à rebours.
  const firstExpiry = mySeats
    .map((s) => s.expiresAt)
    .filter((e): e is string => e !== null)
    .sort()[0];

  return { session, trip, seats, seatsKey, mySeats, firstExpiry };
}
