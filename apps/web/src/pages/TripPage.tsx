import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MAX_HOLDS_PER_TRIP, type SeatStatus, type TripSeatsResponse } from '@billetterie/shared';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { HoldTimer } from '../components/HoldTimer';
import { SeatLegend, SeatMap, seatKind } from '../components/SeatMap';
import { ErrorState, SeatMapSkeleton } from '../components/States';
import { useDemoLogin } from '../hooks/useDemoLogin';
import { useHoldExpiry } from '../hooks/useHoldExpiry';
import { useNow } from '../hooks/useNow';
import { freeSeat, useTripRealtime } from '../hooks/useTripRealtime';
import { useTripSeats } from '../hooks/useTripSeats';
import { errorMessage, isApiRequestError } from '../lib/api';
import { api, queryKeys } from '../lib/endpoints';
import { formatDay, formatFcfa, formatTime, plural } from '../lib/format';
import { useToast } from '../lib/toast';

export function TripPage() {
  const { id = '' } = useParams();
  return <TripView key={id} tripId={id} />;
}

function TripView({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const location = useLocation();
  const now = useNow(30_000);
  const { session, trip, seats, seatsKey, mySeats, firstExpiry } = useTripSeats(tripId);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const demo = useDemoLogin();

  useTripRealtime(tripId);
  useHoldExpiry(tripId, mySeats);

  const setPendingSeat = (seatNumber: number, on: boolean) =>
    setPending((current) => {
      const next = new Set(current);
      if (on) next.add(seatNumber);
      else next.delete(seatNumber);
      return next;
    });

  const changeSeat = (seatNumber: number, change: (seat: SeatStatus) => SeatStatus) =>
    queryClient.setQueryData<TripSeatsResponse>(
      seatsKey,
      (old) =>
        old && {
          ...old,
          seats: old.seats.map((s) => (s.seatNumber === seatNumber ? change(s) : s)),
        },
    );

  const reloadSeats = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.seatsOfTrip(tripId) });

  const hold = useMutation({
    mutationFn: (seatNumber: number) => api.hold(tripId, seatNumber),
    onMutate: (seatNumber) => setPendingSeat(seatNumber, true),
    onSuccess: (result) =>
      changeSeat(result.seatNumber, (s) => ({
        ...s,
        state: 'held',
        heldByMe: true,
        expiresAt: result.expiresAt,
      })),
    onError: (error) => {
      toast.show(
        isApiRequestError(error, 'SEAT_TAKEN')
          ? 'Cette place vient d’être prise.'
          : errorMessage(error),
        'error',
      );
      if (!isApiRequestError(error, 'NETWORK_ERROR', 'RATE_LIMITED')) void reloadSeats();
    },
    onSettled: (_data, _error, seatNumber) => setPendingSeat(seatNumber, false),
  });

  const release = useMutation({
    mutationFn: (seatNumber: number) => api.release(tripId, seatNumber),
    onMutate: (seatNumber) => setPendingSeat(seatNumber, true),
    onSuccess: (_data, seatNumber) => changeSeat(seatNumber, freeSeat),
    onError: (error) => {
      // 404 : le blocage avait déjà expiré. Dans tous les cas, l'état réel vient de l'API.
      toast.show(errorMessage(error), 'error');
      void reloadSeats();
    },
    onSettled: (_data, _error, seatNumber) => setPendingSeat(seatNumber, false),
  });

  if (trip.isError) {
    return (
      <ErrorState error={trip.error} onRetry={() => void trip.refetch()}>
        <Link to="/" className="btn-secondary">
          Nouvelle recherche
        </Link>
      </ErrorState>
    );
  }
  if (trip.isPending) return <SeatMapSkeleton />;

  const detail = trip.data;
  const closed = detail.status === 'cancelled' || Date.parse(detail.departureAt) <= now;
  const isTraveler = session?.user.role === 'traveler';

  const onSeatClick = (seat: SeatStatus) => {
    const kind = seatKind(seat);
    if (!isTraveler) {
      toast.show('Connectez-vous en voyageur pour choisir une place.');
      return;
    }
    if (kind === 'mine') return release.mutate(seat.seatNumber);
    if (kind !== 'free') return;
    if (mySeats.length + pending.size >= MAX_HOLDS_PER_TRIP) {
      toast.show(`${MAX_HOLDS_PER_TRIP} places au plus par réservation.`, 'error');
      return;
    }
    hold.mutate(seat.seatNumber);
  };

  return (
    <div className="space-y-4 pb-40">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">
            {detail.origin} → {detail.destination}
          </h1>
          <ConnectionBadge />
        </div>
        <p className="text-slate-600">
          <span className="capitalize">{formatDay(detail.departureAt)}</span> à{' '}
          <strong>{formatTime(detail.departureAt)}</strong> · {formatFcfa(detail.priceFcfa)} la
          place · {detail.busName}
        </p>
      </header>

      {closed && (
        <p role="alert" className="rounded-lg bg-slate-200 p-3 text-slate-800">
          {detail.status === 'cancelled'
            ? 'Ce départ est annulé.'
            : 'Ce car est déjà parti : les réservations sont fermées.'}
        </p>
      )}

      {!closed && !isTraveler && (
        <div className="card space-y-3">
          <p className="text-sm">
            {session
              ? 'Ce compte ne peut pas réserver : connectez-vous avec un compte voyageur.'
              : 'Pour choisir une place, connectez-vous (ou essayez le compte de démo).'}
          </p>
          <div className="flex flex-wrap gap-2">
            {!session && (
              <button
                type="button"
                className="btn-primary"
                disabled={demo.isPending}
                onClick={() => demo.mutate('traveler')}
              >
                Essayer en voyageur
              </button>
            )}
            <Link
              to={`/connexion?next=${encodeURIComponent(location.pathname)}`}
              className="btn-secondary"
            >
              Se connecter
            </Link>
          </div>
        </div>
      )}

      {seats.isError ? (
        <ErrorState error={seats.error} onRetry={() => void seats.refetch()} />
      ) : seats.isPending ? (
        <SeatMapSkeleton />
      ) : (
        <>
          <SeatMap
            layout={detail.layout}
            seats={seats.data.seats}
            pendingSeats={pending}
            onSeatClick={closed ? undefined : onSeatClick}
          />
          <SeatLegend />
        </>
      )}

      {mySeats.length > 0 && (
        <aside
          aria-label="Récapitulatif"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur"
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex-1 text-sm">
              <p>
                <strong>{plural(mySeats.length, 'place')}</strong> :{' '}
                {mySeats.map((s) => s.seatNumber).join(', ')} ·{' '}
                <strong>{formatFcfa(mySeats.length * detail.priceFcfa)}</strong>
              </p>
              {firstExpiry && (
                <p className="text-slate-600">
                  Bloquée{mySeats.length > 1 ? 's' : ''} encore{' '}
                  <HoldTimer expiresAt={firstExpiry} />
                </p>
              )}
            </div>
            <Link to={`/trajets/${tripId}/passagers`} className="btn-primary">
              Continuer
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}
