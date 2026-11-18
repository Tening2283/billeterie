import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SeatStatus } from '@billetterie/shared';
import { queryKeys } from '../lib/endpoints';
import { useToast } from '../lib/toast';

/** Marge après l'échéance affichée, le temps que Redis ait vraiment supprimé le blocage. */
const GRACE_MS = 1000;

/**
 * Quand un de mes blocages arrive à échéance : message clair, puis rechargement des places.
 * Le compte à rebours n'est qu'un affichage : l'API reste la référence.
 */
export function useHoldExpiry(tripId: string, mySeats: SeatStatus[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const announced = useRef(new Set<string>());

  // Une clé stable : l'effet ne repart que si mes blocages changent vraiment.
  const holdsKey = mySeats
    .filter((s) => s.expiresAt)
    .map((s) => `${s.seatNumber}@${s.expiresAt}`)
    .join(',');

  useEffect(() => {
    if (!holdsKey) return;
    const timers = holdsKey.split(',').map((entry) => {
      const [seat, expiresAt] = entry.split('@') as [string, string];
      const delay = Math.max(0, Date.parse(expiresAt) - Date.now()) + GRACE_MS;
      return setTimeout(() => {
        if (!announced.current.has(entry)) {
          announced.current.add(entry);
          toast.show(`Votre blocage de la place ${seat} a expiré : elle a été relâchée.`, 'error');
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.seatsOfTrip(tripId) });
      }, delay);
    });
    return () => timers.forEach(clearTimeout);
  }, [holdsKey, tripId, queryClient, toast]);
}
