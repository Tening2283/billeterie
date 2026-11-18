import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { VerifyTicketResponse } from '@billetterie/shared';
import { ErrorState, Skeleton } from '../components/States';
import { api } from '../lib/endpoints';
import { formatDay, formatTime } from '../lib/format';

// La bibliothèque de scan n'est téléchargée que si le contrôleur ouvre la caméra.
const QrScanner = lazy(() =>
  import('../components/QrScanner').then((m) => ({ default: m.QrScanner })),
);

export function ControlPage() {
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const verify = useMutation({ mutationFn: (value: string) => api.verifyTicket(value) });

  const check = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) verify.mutate(trimmed);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    check(code);
  };
  const next = () => {
    verify.reset();
    setCode('');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Contrôle des billets</h1>

      {verify.isSuccess ? (
        <>
          <VerifyResultPanel response={verify.data} />
          <button type="button" className="btn-primary w-full" onClick={next}>
            Contrôler le billet suivant
          </button>
        </>
      ) : (
        <>
          {scanning ? (
            <div className="space-y-2">
              <Suspense fallback={<Skeleton className="h-64" />}>
                <QrScanner
                  onScan={(scanned) => {
                    setScanning(false);
                    check(scanned);
                  }}
                />
              </Suspense>
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => setScanning(false)}
              >
                Fermer la caméra
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary w-full" onClick={() => setScanning(true)}>
              <span aria-hidden="true">📷</span> Scanner avec la caméra
            </button>
          )}

          <form onSubmit={submit} className="card space-y-3" aria-label="Vérifier un code">
            <label htmlFor="ticket-code" className="label">
              Ou collez le code du billet
            </label>
            <textarea
              id="ticket-code"
              className="field font-mono text-sm"
              rows={3}
              maxLength={512}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="submit"
              className="btn-secondary w-full"
              disabled={!code.trim() || verify.isPending}
            >
              {verify.isPending ? 'Vérification…' : 'Vérifier'}
            </button>
          </form>

          {verify.isError && (
            <ErrorState error={verify.error} onRetry={() => check(verify.variables ?? code)} />
          )}
        </>
      )}
    </div>
  );
}

const panels = {
  valid: {
    title: 'Billet valide',
    icon: '✓',
    className: 'border-emerald-600 bg-emerald-50 text-emerald-900',
  },
  already_used: {
    title: 'Déjà utilisé',
    icon: '!',
    className: 'border-amber-500 bg-amber-50 text-amber-900',
  },
  invalid: { title: 'Faux billet', icon: '✕', className: 'border-red-600 bg-red-50 text-red-900' },
} as const;

/** Résultat en grand, lisible d'un coup d'œil sur le quai. */
export function VerifyResultPanel({ response }: { response: VerifyTicketResponse }) {
  const panel = panels[response.result];
  const ticket = response.ticket;
  return (
    <div
      role="status"
      aria-label="Résultat du contrôle"
      className={`rounded-2xl border-4 p-6 text-center ${panel.className}`}
    >
      <p aria-hidden="true" className="text-6xl leading-none font-black">
        {panel.icon}
      </p>
      <p className="mt-2 text-3xl font-bold">{panel.title}</p>
      {response.result === 'already_used' && ticket?.usedAt && (
        <p className="mt-1">
          Contrôlé le <span>{formatDay(ticket.usedAt)}</span> à {formatTime(ticket.usedAt)}
        </p>
      )}
      {response.result === 'invalid' && (
        <p className="mt-1">Code inconnu, falsifié, annulé ou trajet terminé.</p>
      )}
      {ticket && (
        <dl className="mx-auto mt-4 grid max-w-xs grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-left">
          <dt className="font-medium">Passager</dt>
          <dd>{ticket.passengerName}</dd>
          <dt className="font-medium">Place</dt>
          <dd>{ticket.seatNumber}</dd>
          <dt className="font-medium">Trajet</dt>
          <dd>
            {ticket.trip.origin} → {ticket.trip.destination}
          </dd>
          <dt className="font-medium">Départ</dt>
          <dd>
            {formatDay(ticket.trip.departureAt)} à {formatTime(ticket.trip.departureAt)}
          </dd>
        </dl>
      )}
    </div>
  );
}
