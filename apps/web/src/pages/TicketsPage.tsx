import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Ticket } from '@billetterie/shared';
import { TicketQr } from '../components/TicketQr';
import { ErrorState, ListSkeleton } from '../components/States';
import { api, queryKeys } from '../lib/endpoints';
import { formatDay, formatFcfa, formatTime } from '../lib/format';

const statusBadge: Record<Ticket['status'], { label: string; className: string }> = {
  valid: { label: '✓ Valide', className: 'bg-emerald-100 text-emerald-800' },
  used: { label: '● Utilisé', className: 'bg-slate-200 text-slate-700' },
  cancelled: { label: '✕ Annulé', className: 'bg-red-100 text-red-800' },
};

export function TicketsPage() {
  const bookings = useQuery({ queryKey: queryKeys.bookings, queryFn: api.myBookings });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Mes billets</h1>
      {bookings.isPending ? (
        <ListSkeleton label="Chargement des billets" rows={2} />
      ) : bookings.isError ? (
        <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />
      ) : bookings.data.bookings.length === 0 ? (
        <div className="card space-y-3 text-center">
          <p className="font-medium">Vous n’avez pas encore de billet.</p>
          <Link to="/" className="btn-primary">
            Chercher un trajet
          </Link>
        </div>
      ) : (
        bookings.data.bookings.map((booking) => (
          <section
            key={booking.id}
            className="card space-y-3"
            aria-label={`Réservation ${booking.trip.origin} → ${booking.trip.destination}`}
          >
            <header>
              <h2 className="font-semibold">
                {booking.trip.origin} → {booking.trip.destination}
              </h2>
              <p className="text-sm text-slate-600">
                <span className="capitalize">{formatDay(booking.trip.departureAt)}</span> à{' '}
                {formatTime(booking.trip.departureAt)} · {booking.trip.busName} ·{' '}
                {formatFcfa(booking.totalFcfa)}
              </p>
            </header>
            <ul className="grid gap-3 sm:grid-cols-2">
              {booking.tickets.map((ticket) => {
                const badge = statusBadge[ticket.status];
                return (
                  <li key={ticket.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{ticket.passengerName}</p>
                        <p className="text-sm text-slate-600">Place {ticket.seatNumber}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    {ticket.status === 'valid' ? (
                      <TicketQr ticketId={ticket.id} seatNumber={ticket.seatNumber} />
                    ) : ticket.status === 'used' && ticket.usedAt ? (
                      <p className="text-sm text-slate-600">
                        Contrôlé à {formatTime(ticket.usedAt)}.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
