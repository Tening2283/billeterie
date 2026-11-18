/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL de l'API en production (ex. https://billetterie-api.onrender.com). Vide en local : proxy Vite. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
