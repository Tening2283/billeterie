import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  SeatHeldEvent,
  SeatReleasedEvent,
  SeatSoldEvent,
  SeatStatus,
  TripSeatsResponse,
} from '@billetterie/shared';
import { getSocket } from '../lib/socket';
import { queryKeys } from '../lib/endpoints';

/** Modifie une place dans toutes les versions en cache des places du trajet. */
export function updateSeats(
  queryClient: QueryClient,
  tripId: string,
  change: (seat: SeatStatus) => SeatStatus,
) {
  queryClient.setQueriesData<TripSeatsResponse>(
    { queryKey: queryKeys.seatsOfTrip(tripId) },
    (old) => old && { ...old, seats: old.seats.map(change) },
  );
}

export const freeSeat = (seat: SeatStatus): SeatStatus => ({
  ...seat,
  state: 'free',
  heldByMe: false,
  expiresAt: null,
});

/**
 * Salle Socket.io du trajet : chaque événement met à jour le cache directement, sans recharger.
 * À chaque reconnexion, on recharge les places : des événements ont pu être manqués pendant la coupure.
 */
export function useTripRealtime(tripId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const join = () => socket.emit('trip:join', tripId);
    const onReconnect = () => {
      join();
      void queryClient.invalidateQueries({ queryKey: queryKeys.seatsOfTrip(tripId) });
    };

    const onHeld = (event: SeatHeldEvent) => {
      if (event.tripId !== tripId) return;
      updateSeats(queryClient, tripId, (seat) =>
        // Mon propre blocage est déjà affiché par la réponse REST : on ne l'écrase pas.
        seat.seatNumber === event.seatNumber && seat.state !== 'sold' && !seat.heldByMe
          ? { ...seat, state: 'held', heldByMe: false, expiresAt: event.expiresAt }
          : seat,
      );
    };
    const onReleased = (event: SeatReleasedEvent) => {
      if (event.tripId !== tripId) return;
      updateSeats(queryClient, tripId, (seat) =>
        seat.seatNumber === event.seatNumber && seat.state === 'held' ? freeSeat(seat) : seat,
      );
    };
    const onSold = (event: SeatSoldEvent) => {
      if (event.tripId !== tripId) return;
      const sold = new Set(event.seatNumbers);
      updateSeats(queryClient, tripId, (seat) =>
        sold.has(seat.seatNumber)
          ? { ...seat, state: 'sold', heldByMe: false, expiresAt: null }
          : seat,
      );
    };

    if (socket.connected) join();
    socket.on('connect', onReconnect);
    socket.on('seat:held', onHeld);
    socket.on('seat:released', onReleased);
    socket.on('seat:sold', onSold);

    return () => {
      socket.off('connect', onReconnect);
      socket.off('seat:held', onHeld);
      socket.off('seat:released', onReleased);
      socket.off('seat:sold', onSold);
      socket.emit('trip:leave', tripId);
    };
  }, [tripId, queryClient]);
}
