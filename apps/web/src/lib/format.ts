/** Les dates sont stockées en UTC et affichées en heure de Dakar (UTC+0, sans heure d'été). */
export const TIME_ZONE = 'Africa/Dakar';

const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const isoDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const numberFormat = new Intl.NumberFormat('fr-FR');

/** « 07:30 » */
export const formatTime = (iso: string) => timeFormat.format(new Date(iso));

/** « mercredi 18 novembre » */
export const formatDay = (iso: string) => dayFormat.format(new Date(iso));

/** Jour AAAA-MM-JJ (paramètre de recherche) → « mercredi 18 novembre ». */
export const formatDayParam = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));

/** « 4 000 FCFA » : l'argent est toujours un entier. Espaces normales, pour rester lisible partout. */
export const formatFcfa = (amount: number) =>
  `${numberFormat.format(amount).replace(/\s/g, ' ')} FCFA`;

/** Jour courant à Dakar, au format AAAA-MM-JJ. */
export const todayInDakar = (now = new Date()) => isoDayFormat.format(now);

/** Décale un jour AAAA-MM-JJ de n jours. */
export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Temps restant « m:ss », jamais négatif. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** « 1 place », « 3 places » */
export const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
