type Handler = (...args: unknown[]) => void;

/** Doublure de Socket.io : on simule le serveur (événements, coupures) sans réseau. */
export function createFakeSocket() {
  const handlers = new Map<string, Set<Handler>>();
  const fire = (event: string, ...args: unknown[]) =>
    handlers.get(event)?.forEach((handler) => handler(...args));

  return {
    connected: true,
    /** Ce que le front a envoyé au serveur (trip:join, trip:leave). */
    sent: [] as Array<[string, ...unknown[]]>,
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return this;
    },
    off(event: string, handler: Handler) {
      handlers.get(event)?.delete(handler);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      this.sent.push([event, ...args]);
      return this;
    },
    /** Le serveur envoie un événement à la salle. */
    serverEmit: fire,
    disconnect() {
      this.connected = false;
      fire('disconnect');
    },
    reconnect() {
      this.connected = true;
      fire('connect');
    },
    reset() {
      handlers.clear();
      this.sent = [];
      this.connected = true;
    },
  };
}

export const fakeSocket = createFakeSocket();
