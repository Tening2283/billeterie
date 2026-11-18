import { buildSeatPositions, type BusLayout, type SeatStatus } from '@billetterie/shared';
import type { CSSProperties } from 'react';

/** Les quatre états vus par le visiteur : « bloquée » se dédouble selon qui bloque. */
export type SeatKind = 'free' | 'mine' | 'other' | 'sold';

export function seatKind(seat: SeatStatus): SeatKind {
  if (seat.state === 'held') return seat.heldByMe ? 'mine' : 'other';
  return seat.state;
}

export const SEAT_LABELS: Record<SeatKind, string> = {
  free: 'libre',
  mine: 'bloquée par vous',
  other: 'bloquée par un autre voyageur',
  sold: 'vendue',
};

/**
 * Chaque état a une couleur ET un signe (icône, motif) : la carte reste lisible pour les daltoniens.
 * « Bloquée par un autre » est hachurée, « vendue » barrée d'une croix.
 */
const kindClasses: Record<SeatKind, string> = {
  free: 'border-emerald-600 bg-white text-emerald-800 hover:bg-emerald-50 active:bg-emerald-100',
  mine: 'border-sky-700 bg-sky-700 text-white shadow-inner',
  other:
    'border-amber-500 text-amber-900 bg-[repeating-linear-gradient(135deg,#fef3c7_0_6px,#fde68a_6px_12px)] cursor-not-allowed',
  sold: 'border-slate-300 bg-slate-200 text-slate-500 cursor-not-allowed',
};

const kindIcons: Record<SeatKind, string | null> = {
  free: null,
  mine: '✓',
  other: '⏳',
  sold: '✕',
};

interface SeatProps {
  seat: SeatStatus;
  pending?: boolean;
  onClick?: (seat: SeatStatus) => void;
  style?: CSSProperties;
}

export function Seat({ seat, pending = false, onClick, style }: SeatProps) {
  const kind = seatKind(seat);
  const icon = kindIcons[kind];
  // Seules les places libres ou les miennes réagissent au clic (bloquer / relâcher).
  const interactive = kind === 'free' || kind === 'mine';

  return (
    <button
      type="button"
      style={style}
      aria-label={`Place ${seat.seatNumber}, ${SEAT_LABELS[kind]}`}
      aria-pressed={kind === 'mine'}
      aria-busy={pending || undefined}
      disabled={!interactive || pending}
      data-kind={kind}
      onClick={() => onClick?.(seat)}
      className={`relative flex h-12 min-w-11 flex-col items-center justify-center rounded-lg border-2 text-sm font-semibold transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${kindClasses[kind]} ${pending ? 'animate-pulse' : ''}`}
    >
      <span className={kind === 'sold' ? 'line-through' : undefined}>{seat.seatNumber}</span>
      {icon && (
        <span aria-hidden="true" className="text-[0.7rem] leading-none">
          {icon}
        </span>
      )}
    </button>
  );
}

interface SeatMapProps {
  layout: BusLayout;
  seats: SeatStatus[];
  onSeatClick?: (seat: SeatStatus) => void;
  /** Places dont une requête est en cours (blocage ou relâche). */
  pendingSeats?: ReadonlySet<number>;
}

/** Plan du car construit à partir du `layout` : rangées, colonnes et allée. */
export function SeatMap({ layout, seats, onSeatClick, pendingSeats }: SeatMapProps) {
  const byNumber = new Map(seats.map((s) => [s.seatNumber, s]));
  const positions = buildSeatPositions(layout, seats.length);
  const hasAisle = layout.aisleAfter > 0;
  const gridColumns = layout.columns + (hasAisle ? 1 : 0);

  return (
    <div className="rounded-3xl border-2 border-slate-300 bg-slate-50 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <span>Avant du car</span>
        <span aria-hidden="true" className="rounded border border-slate-300 px-2 py-1">
          🚍 Chauffeur
        </span>
      </div>
      <div
        role="group"
        aria-label="Plan du car"
        className="grid gap-2"
        style={{
          gridTemplateColumns: hasAisle
            ? `repeat(${layout.aisleAfter}, minmax(0, 1fr)) 0.6fr repeat(${layout.columns - layout.aisleAfter}, minmax(0, 1fr))`
            : `repeat(${gridColumns}, minmax(0, 1fr))`,
        }}
      >
        {positions.map((position) => {
          const seat = byNumber.get(position.seatNumber);
          if (!seat) return null;
          const column =
            position.column + 1 + (hasAisle && position.column >= layout.aisleAfter ? 1 : 0);
          return (
            <Seat
              key={position.seatNumber}
              seat={seat}
              pending={pendingSeats?.has(position.seatNumber)}
              onClick={onSeatClick}
              style={{ gridRow: position.row + 1, gridColumn: column }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Légende : mêmes couleurs et mêmes signes que sur le plan. */
export function SeatLegend() {
  const items: SeatKind[] = ['free', 'mine', 'other', 'sold'];
  return (
    <ul className="grid grid-cols-2 gap-2 text-sm text-slate-700" aria-label="Légende du plan">
      {items.map((kind) => (
        <li key={kind} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`flex h-6 w-6 items-center justify-center rounded border-2 text-[0.7rem] ${kindClasses[kind]}`}
          >
            {kindIcons[kind]}
          </span>
          {SEAT_LABELS[kind].charAt(0).toUpperCase() + SEAT_LABELS[kind].slice(1)}
        </li>
      ))}
    </ul>
  );
}
