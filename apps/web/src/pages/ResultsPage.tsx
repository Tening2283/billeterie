import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { searchTripsQuerySchema, type SearchTripsQuery } from '@billetterie/shared';
import { api, queryKeys } from '../lib/endpoints';
import {
  addDays,
  formatDayParam,
  formatFcfa,
  formatTime,
  plural,
  todayInDakar,
} from '../lib/format';
import { ErrorState, ListSkeleton } from '../components/States';

const searchUrl = (query: SearchTripsQuery, date: string) =>
  `/trajets?${new URLSearchParams({ ...query, date })}`;

export function ResultsPage() {
  const [params] = useSearchParams();
  const parsed = searchTripsQuerySchema.safeParse({
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    date: params.get('date') ?? '',
  });

  if (!parsed.success) {
    return (
      <div role="alert" className="card space-y-3">
        <p>Recherche incomplète : choisissez un départ, une arrivée et une date.</p>
        <Link to="/" className="btn-primary">
          Nouvelle recherche
        </Link>
      </div>
    );
  }
  return <Results query={parsed.data} />;
}

function Results({ query }: { query: SearchTripsQuery }) {
  const trips = useQuery({
    queryKey: queryKeys.trips(query),
    queryFn: () => api.searchTrips(query),
  });
  const canGoBack = query.date > todayInDakar();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">
          {query.from} → {query.to}
        </h1>
        <div className="mt-2 flex items-center justify-between gap-2">
          {canGoBack ? (
            <Link
              to={searchUrl(query, addDays(query.date, -1))}
              className="btn-secondary px-3"
              aria-label="Jour précédent"
            >
              ←
            </Link>
          ) : (
            <span className="w-11" />
          )}
          <p className="text-center font-medium capitalize">{formatDayParam(query.date)}</p>
          <Link
            to={searchUrl(query, addDays(query.date, 1))}
            className="btn-secondary px-3"
            aria-label="Jour suivant"
          >
            →
          </Link>
        </div>
      </header>

      {trips.isPending ? (
        <ListSkeleton label="Chargement des départs" />
      ) : trips.isError ? (
        <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
      ) : trips.data.trips.length === 0 ? (
        <div className="card space-y-3 text-center">
          <p className="font-medium">Aucun départ ce jour-là.</p>
          <p className="text-sm text-slate-600">Essayez une autre date :</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to={searchUrl(query, addDays(query.date, 1))} className="btn-primary">
              Voir le lendemain
            </Link>
            <Link to="/" className="btn-secondary">
              Changer la recherche
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Départs">
          {trips.data.trips.map((trip) => {
            const full = trip.remainingSeats === 0;
            return (
              <li key={trip.id}>
                <Link
                  to={`/trajets/${trip.id}`}
                  className="card flex items-center gap-4 hover:border-sky-400 focus-visible:outline-3 focus-visible:outline-sky-500"
                >
                  <span className="text-2xl font-bold tabular-nums">
                    {formatTime(trip.departureAt)}
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">{formatFcfa(trip.priceFcfa)}</span>
                    <span className="block text-sm text-slate-600">{trip.busName}</span>
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-sm font-medium ${
                      full ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {full
                      ? 'Complet'
                      : `${plural(trip.remainingSeats, 'place')} ${trip.remainingSeats > 1 ? 'libres' : 'libre'}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
