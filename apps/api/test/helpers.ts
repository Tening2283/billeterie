import { createApp, type AppDeps } from '../src/app';
import { createLogger } from '../src/lib/logger';

export const silentLogger = createLogger('silent');

export function buildTestApp(overrides: Partial<AppDeps> = {}) {
  return createApp({ logger: silentLogger, corsOrigins: ['http://localhost:5173'], ...overrides });
}
