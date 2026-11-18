/**
 * Ouvre une connexion avant les tests d'un fichier, avec quelques essais.
 *
 * Chaque fichier de test tourne dans son propre processus, donc avec de nouvelles connexions
 * (TLS vers Neon et Upstash). Depuis une connexion lointaine (Dakar → Frankfurt), la première
 * peut prendre plusieurs secondes, voire échouer une fois. On la paie ici, une seule fois, pour
 * que les délais vérifiés par les tests (ex. /health en moins de 2 s) portent sur des connexions
 * établies, comme en production. En CI, base et Redis sont des conteneurs locaux : instantané.
 */
export async function warmUp(name: string, connect: () => Promise<unknown>, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      await connect();
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw new Error(`${name} injoignable après ${attempts} essais`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}
