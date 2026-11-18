import type { BusLayout } from '@billetterie/shared';

/** Données de démo : pas d'interface admin dans le MVP, tout vient d'ici. */

export interface DemoBus {
  name: string;
  seatCount: number;
  layout: BusLayout;
}

export interface DemoLine {
  origin: string;
  destination: string;
  priceFcfa: number;
  busName: string;
  /** Heures de départ, en heure de Dakar (= UTC). */
  departureHours: number[];
}

export const DEMO_BUSES: DemoBus[] = [
  { name: 'Minibus 15 places', seatCount: 15, layout: { rows: 5, columns: 3, aisleAfter: 1 } },
  { name: 'Car 50 places', seatCount: 50, layout: { rows: 10, columns: 5, aisleAfter: 2 } },
];

const ONE_WAY: DemoLine[] = [
  {
    origin: 'Dakar',
    destination: 'Thiès',
    priceFcfa: 2000,
    busName: 'Minibus 15 places',
    departureHours: [7, 10, 14, 18],
  },
  {
    origin: 'Thiès',
    destination: 'Saint-Louis',
    priceFcfa: 5000,
    busName: 'Car 50 places',
    departureHours: [8, 15],
  },
  {
    origin: 'Dakar',
    destination: 'Touba',
    priceFcfa: 5000,
    busName: 'Car 50 places',
    departureHours: [6, 13],
  },
  {
    origin: 'Dakar',
    destination: 'Mbour',
    priceFcfa: 2500,
    busName: 'Minibus 15 places',
    departureHours: [7, 12, 17],
  },
];

/** Chaque ligne existe dans les deux sens. */
export const DEMO_LINES: DemoLine[] = ONE_WAY.flatMap((line) => [
  line,
  { ...line, origin: line.destination, destination: line.origin },
]);

/** Domaine réservé aux comptes de démo : personne ne peut s'inscrire avec. */
export const DEMO_EMAIL_DOMAIN = '@demo.test';
export const isDemoEmail = (email: string) => email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);

export const DEMO_USERS = [
  { email: 'voyageur@demo.test', name: 'Voyageur démo', role: 'traveler' },
  { email: 'controleur@demo.test', name: 'Contrôleur démo', role: 'controller' },
] as const;
