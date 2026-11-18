import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SeatLegend, SeatMap } from './SeatMap';
import { inMinutes, seatList } from '../test/render';

const layout = { rows: 5, columns: 3, aisleAfter: 1 };

describe('SeatMap', () => {
  it('affiche les quatre états, chacun avec un libellé accessible et un signe en plus de la couleur', () => {
    const seats = seatList({
      2: { state: 'held', heldByMe: true, expiresAt: inMinutes(9) },
      3: { state: 'held', heldByMe: false, expiresAt: inMinutes(5) },
      4: { state: 'sold' },
    });
    render(<SeatMap layout={layout} seats={seats} />);

    const map = screen.getByRole('group', { name: 'Plan du car' });
    expect(within(map).getAllByRole('button')).toHaveLength(15);

    const free = screen.getByRole('button', { name: 'Place 1, libre' });
    const mine = screen.getByRole('button', { name: 'Place 2, bloquée par vous' });
    const other = screen.getByRole('button', { name: 'Place 3, bloquée par un autre voyageur' });
    const sold = screen.getByRole('button', { name: 'Place 4, vendue' });

    expect(free).toBeEnabled();
    expect(mine).toBeEnabled();
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    expect(other).toBeDisabled();
    expect(sold).toBeDisabled();
    // Pas seulement la couleur : une icône pour « à moi », « autre » et « vendue ».
    expect(mine).toHaveTextContent('✓');
    expect(other).toHaveTextContent('⏳');
    expect(sold).toHaveTextContent('✕');
    expect(free).toHaveTextContent(/^1$/);
  });

  it('place l’allée au bon endroit : la 2e colonne de sièges est décalée d’une colonne', () => {
    render(<SeatMap layout={layout} seats={seatList()} />);
    expect(screen.getByRole('button', { name: 'Place 1, libre' }).style.gridColumn).toBe('1');
    expect(screen.getByRole('button', { name: 'Place 2, libre' }).style.gridColumn).toBe('3');
    expect(screen.getByRole('button', { name: 'Place 4, libre' }).style.gridRow).toBe('2');
  });

  it('transmet le clic sur une place libre ; une place en cours de traitement est désactivée', async () => {
    const onSeatClick = vi.fn();
    render(
      <SeatMap
        layout={layout}
        seats={seatList()}
        onSeatClick={onSeatClick}
        pendingSeats={new Set([5])}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Place 7, libre' }));
    expect(onSeatClick).toHaveBeenCalledWith(expect.objectContaining({ seatNumber: 7 }));
    expect(screen.getByRole('button', { name: 'Place 5, libre' })).toBeDisabled();
  });

  it('fonctionne sans allée', () => {
    render(
      <SeatMap layout={{ rows: 2, columns: 2, aisleAfter: 0 }} seats={seatList().slice(0, 4)} />,
    );
    expect(screen.getByRole('button', { name: 'Place 2, libre' }).style.gridColumn).toBe('2');
  });

  it('la légende reprend les quatre états', () => {
    render(<SeatLegend />);
    const legend = screen.getByRole('list', { name: 'Légende du plan' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Libre', '✓Bloquée par vous', '⏳Bloquée par un autre voyageur', '✕Vendue']);
  });
});
