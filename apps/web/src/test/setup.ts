import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { fakeSocket } from './fake-socket';
import { sessionStore } from '../lib/session';

// Aucune vraie connexion Socket.io dans les tests : une doublure pilotée par le test.
vi.mock('../lib/socket', async () => {
  const { fakeSocket } = await import('./fake-socket');
  return { getSocket: () => fakeSocket };
});

beforeEach(() => {
  localStorage.clear();
  sessionStore.clear();
  fakeSocket.reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
