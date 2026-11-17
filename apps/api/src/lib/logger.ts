import { pino, type Logger, type LevelWithSilent } from 'pino';

export function createLogger(level: LevelWithSilent): Logger {
  return pino({
    level,
    // Jamais de mot de passe ni de jeton dans les logs.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        '*.password',
        '*.token',
      ],
      censor: '[masqué]',
    },
  });
}
