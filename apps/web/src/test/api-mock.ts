import { vi } from 'vitest';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockReply {
  status?: number;
  body?: unknown;
}

type Handler = (req: MockRequest) => MockReply | Promise<MockReply>;
type Routes = Record<string, Handler | MockReply>;

/** Erreur au format de l'API. */
export const apiError = (status: number, code: string, message: string): MockReply => ({
  status,
  body: { error: { code, message, details: {} } },
});

const toRegex = (pattern: string) => new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '[^/]+')}$`);

/**
 * Remplace fetch : clés « POST /trips/:id/holds » (chemin après /api/v1, paramètres `:x` acceptés).
 * Toute requête non prévue échoue bruyamment. /health répond 200 par défaut (bandeau de réveil).
 */
export function mockApi(routes: Routes) {
  const calls: MockRequest[] = [];
  const all: Routes = { 'GET /health': { body: { status: 'ok', checks: {} } }, ...routes };
  const matchers = Object.entries(all).map(([key, handler]) => {
    const [method, pattern] = key.split(' ') as [string, string];
    return { method, regex: toRegex(pattern), handler };
  });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const req: MockRequest = {
      method,
      path,
      query: url.searchParams,
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    const match = matchers.find((m) => m.method === method && m.regex.test(path));
    if (!match) throw new Error(`Requête inattendue : ${method} ${path}`);
    if (path !== '/health') calls.push(req);
    const reply = typeof match.handler === 'function' ? await match.handler(req) : match.handler;
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  /** Requêtes reçues pour « MÉTHODE /chemin » (mêmes motifs `:x` que les routes). */
  const callsTo = (key: string) => {
    const [method, pattern] = key.split(' ') as [string, string];
    const regex = toRegex(pattern);
    return calls.filter((c) => c.method === method && regex.test(c.path));
  };
  return { calls, fetchMock, callsTo };
}
