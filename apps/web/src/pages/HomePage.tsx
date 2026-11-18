import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { searchTripsQuerySchema } from '@billetterie/shared';
import { useDemoLogin } from '../hooks/useDemoLogin';
import { todayInDakar } from '../lib/format';
import { useSession } from '../lib/session';

/** Villes desservies par les données de démo (pas d'interface admin dans le MVP). */
export const CITIES = ['Dakar', 'Thiès', 'Saint-Louis', 'Touba', 'Mbour'];

export function HomePage() {
  const navigate = useNavigate();
  const session = useSession();
  const [from, setFrom] = useState('Dakar');
  const [to, setTo] = useState('Thiès');
  const [date, setDate] = useState(() => todayInDakar());
  const [error, setError] = useState<string | null>(null);
  const demo = useDemoLogin((role) => {
    if (role === 'controller') void navigate('/controle');
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = searchTripsQuerySchema.safeParse({ from, to, date });
    if (!query.success) return setError(query.error.issues[0]!.message);
    if (query.data.from === query.data.to) return setError('Choisissez deux villes différentes.');
    setError(null);
    void navigate(`/trajets?${new URLSearchParams(query.data)}`);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold">Billetterie de cars</h1>
        <p className="mt-1 text-slate-600">
          Dakar, Thiès, Saint-Louis… Choisissez votre place sur le plan du car, en direct.
        </p>
      </section>

      <form
        onSubmit={submit}
        className="card space-y-4"
        aria-label="Rechercher un trajet"
        noValidate
      >
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div>
            <label htmlFor="from" className="label">
              Départ
            </label>
            <select
              id="from"
              className="field"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              {CITIES.map((city) => (
                <option key={city}>{city}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={swap}
            className="btn-secondary px-3"
            aria-label="Inverser départ et arrivée"
          >
            ⇄
          </button>
          <div>
            <label htmlFor="to" className="label">
              Arrivée
            </label>
            <select id="to" className="field" value={to} onChange={(e) => setTo(e.target.value)}>
              {CITIES.map((city) => (
                <option key={city}>{city}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="date" className="label">
            Date
          </label>
          <input
            id="date"
            type="date"
            className="field"
            value={date}
            min={todayInDakar()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full">
          Rechercher
        </button>
      </form>

      {!session && (
        <section className="card space-y-3" aria-labelledby="demo-title">
          <h2 id="demo-title" className="font-semibold">
            Essayer sans créer de compte
          </h2>
          <p className="text-sm text-slate-600">
            Comptes de démo partagés : réservez comme un voyageur, ou contrôlez des billets.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={demo.isPending}
              onClick={() => demo.mutate('traveler')}
            >
              Essayer en voyageur
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={demo.isPending}
              onClick={() => demo.mutate('controller')}
            >
              Essayer en contrôleur
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
