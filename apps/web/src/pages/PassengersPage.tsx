import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { passengerSchema, type CreateBookingBody } from '@billetterie/shared';
import { HoldTimer } from '../components/HoldTimer';
import { ErrorState, ListSkeleton } from '../components/States';
import { useHoldExpiry } from '../hooks/useHoldExpiry';
import { useTripRealtime } from '../hooks/useTripRealtime';
import { useTripSeats } from '../hooks/useTripSeats';
import { errorMessage, isApiRequestError } from '../lib/api';
import { api, queryKeys } from '../lib/endpoints';
import { formatDay, formatFcfa, formatTime } from '../lib/format';
import { randomId } from '../lib/random';
import { useToast } from '../lib/toast';

export function PassengersPage() {
  const { id = '' } = useParams();
  return <PassengersForm key={id} tripId={id} />;
}

function PassengersForm({ tripId }: { tripId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { session, trip, seats, mySeats, firstExpiry } = useTripSeats(tripId);
  const [names, setNames] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  /**
   * Une clé d'idempotence par contenu : un double clic ou un renvoi après coupure réseau réutilise
   * la même clé (une seule réservation) ; des noms modifiés après une erreur en prennent une nouvelle.
   */
  const attempt = useRef<{ key: string; body: string } | null>(null);

  useTripRealtime(tripId);
  useHoldExpiry(tripId, mySeats);

  const book = useMutation({
    mutationFn: ({ key, body }: { key: string; body: CreateBookingBody }) =>
      api.createBooking(key, body),
    onSuccess: (booking) => {
      attempt.current = null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      void queryClient.invalidateQueries({ queryKey: queryKeys.seatsOfTrip(tripId) });
      toast.show(
        `Réservation confirmée : ${booking.tickets.length > 1 ? 'vos billets sont prêts' : 'votre billet est prêt'}.`,
        'success',
      );
      void navigate('/billets');
    },
    onError: (error) => {
      if (isApiRequestError(error, 'HOLD_EXPIRED', 'SEAT_SOLD')) {
        toast.show(errorMessage(error), 'error');
        void queryClient.invalidateQueries({ queryKey: queryKeys.seatsOfTrip(tripId) });
        void navigate(`/trajets/${tripId}`);
      }
    },
  });

  if (trip.isError || seats.isError) {
    const retry = () => void Promise.all([trip.refetch(), seats.refetch()]);
    return <ErrorState error={trip.error ?? seats.error} onRetry={retry} />;
  }
  if (trip.isPending || seats.isPending) return <ListSkeleton label="Chargement des places" />;

  if (mySeats.length === 0 && !book.isPending && !book.isSuccess) {
    return (
      <div className="card space-y-3">
        <p className="font-medium">Vous n’avez aucune place bloquée sur ce trajet.</p>
        <p className="text-sm text-slate-600">
          Les places restent bloquées 10 minutes : choisissez-les à nouveau sur le plan.
        </p>
        <Link to={`/trajets/${tripId}`} className="btn-primary">
          Retour au plan du car
        </Link>
      </div>
    );
  }

  const detail = trip.data;
  // Le premier passager prend par défaut le nom du compte.
  const nameOf = (seatNumber: number, index: number) =>
    names[seatNumber] ?? (index === 0 ? (session?.user.name ?? '') : '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const fieldErrors: Record<number, string> = {};
    const passengers = mySeats.map((seat, index) => {
      const result = passengerSchema.safeParse({
        seatNumber: seat.seatNumber,
        passengerName: nameOf(seat.seatNumber, index),
      });
      if (!result.success) fieldErrors[seat.seatNumber] = result.error.issues[0]!.message;
      return result.data!;
    });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    const body: CreateBookingBody = { tripId, passengers };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized)
      attempt.current = { key: randomId(), body: serialized };
    book.mutate({ key: attempt.current.key, body });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Passagers">
      <header>
        <h1 className="text-xl font-bold">Passagers</h1>
        <p className="text-slate-600">
          {detail.origin} → {detail.destination} ·{' '}
          <span className="capitalize">{formatDay(detail.departureAt)}</span> à{' '}
          {formatTime(detail.departureAt)}
        </p>
        {firstExpiry && (
          <p className="mt-1 text-sm">
            Places bloquées encore <HoldTimer expiresAt={firstExpiry} />
          </p>
        )}
      </header>

      <ol className="space-y-3">
        {mySeats.map((seat, index) => {
          const inputId = `passager-${seat.seatNumber}`;
          const error = errors[seat.seatNumber];
          return (
            <li key={seat.seatNumber} className="card">
              <label htmlFor={inputId} className="label">
                Nom du passager — place {seat.seatNumber}
              </label>
              <input
                id={inputId}
                className="field"
                autoComplete={index === 0 ? 'name' : 'off'}
                value={nameOf(seat.seatNumber, index)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
                onChange={(e) => setNames((n) => ({ ...n, [seat.seatNumber]: e.target.value }))}
              />
              {error && (
                <p id={`${inputId}-error`} className="mt-1 text-sm text-red-700">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {book.isError && !isApiRequestError(book.error, 'HOLD_EXPIRED', 'SEAT_SOLD') && (
        <ErrorState error={book.error} />
      )}

      <div className="card flex items-center justify-between gap-3">
        <p>
          Total : <strong>{formatFcfa(mySeats.length * detail.priceFcfa)}</strong>
        </p>
        <button type="submit" className="btn-primary" disabled={book.isPending}>
          {book.isPending ? 'Confirmation…' : book.isError ? 'Réessayer' : 'Confirmer'}
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        Démonstration : confirmer vaut paiement, aucun argent n’est débité.
      </p>
      <Link to={`/trajets/${tripId}`} className="block text-center text-sm text-sky-800 underline">
        Modifier les places
      </Link>
    </form>
  );
}
