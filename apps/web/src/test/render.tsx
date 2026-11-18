import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import type { Role, SeatStatus, TripDetail } from '@billetterie/shared';
import { AppRoutes, Providers } from '../App';
import { sessionStore } from '../lib/session';

export const TRIP_ID = '11111111-1111-4111-8111-111111111111';

/** Où est le routeur : affiché dans le DOM pour vérifier les redirections. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

/** Toute l'appli (routes, toasts, cache) sur une URL donnée, sans relance automatique. */
export function renderApp(url = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const utils = render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  );
  return { ...utils, user, client };
}

const USER_IDS: Record<Role, string> = {
  traveler: '00000000-0000-4000-8000-000000000001',
  controller: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000003',
};

export function signIn(role: Role = 'traveler', name = 'Awa Diop') {
  sessionStore.set({
    token: `jeton-${role}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: USER_IDS[role], email: 'awa@example.com', name, role },
  });
}

export function tripDetail(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: TRIP_ID,
    origin: 'Dakar',
    destination: 'Thiès',
    departureAt: new Date(Date.now() + 86_400_000).toISOString(),
    priceFcfa: 2000,
    busName: 'Minibus 15 places',
    seatCount: 15,
    remainingSeats: 15,
    status: 'scheduled',
    layout: { rows: 5, columns: 3, aisleAfter: 1 },
    ...overrides,
  };
}

/** 15 places libres, sauf celles indiquées. */
export function seatList(overrides: Record<number, Partial<SeatStatus>> = {}): SeatStatus[] {
  return Array.from({ length: 15 }, (_, i) => ({
    seatNumber: i + 1,
    state: 'free' as const,
    heldByMe: false,
    expiresAt: null,
    ...overrides[i + 1],
  }));
}

export const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
