/**
 * Identifiant aléatoire (clé d'idempotence). `crypto.randomUUID` n'existe qu'en contexte sécurisé
 * (https ou localhost) : sur un téléphone en http://192.168.x.x, on retombe sur getRandomValues.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
