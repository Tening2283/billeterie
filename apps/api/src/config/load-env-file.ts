import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Charge un fichier .env sans jamais écraser une variable déjà définie.
 * Ainsi, l'environnement de la CI ou de l'hébergeur (et `.env.test` chargé avant `.env`) a toujours priorité.
 * Retourne false si le fichier n'existe pas (cas normal en production).
 */
export function loadEnvFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const values = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}
