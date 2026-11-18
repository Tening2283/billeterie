/** Origine de l'API. Vide : même origine que le front (proxy Vite en local). */
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
export const API_BASE = `${API_ORIGIN}/api/v1`;
