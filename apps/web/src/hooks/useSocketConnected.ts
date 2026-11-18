import { useSyncExternalStore } from 'react';
import { getSocket } from '../lib/socket';

function subscribe(onChange: () => void) {
  const socket = getSocket();
  socket.on('connect', onChange);
  socket.on('disconnect', onChange);
  return () => {
    socket.off('connect', onChange);
    socket.off('disconnect', onChange);
  };
}

/** Vrai tant que la connexion temps réel est ouverte. */
export function useSocketConnected(): boolean {
  return useSyncExternalStore(subscribe, () => getSocket().connected);
}
