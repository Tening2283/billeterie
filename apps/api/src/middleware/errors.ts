import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@billetterie/shared';
import { ZodError } from 'zod';
import { AppError } from '../lib/app-error';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route introuvable : ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiError = {
    error: { code: 'INTERNAL_ERROR', message: 'Une erreur inattendue est survenue.', details: {} },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Requête invalide.',
        details: { issues: err.issues.map(({ path, message }) => ({ path, message })) },
      },
    };
  } else if (isBodyParserError(err)) {
    status = 400;
    body = { error: { code: 'VALIDATION_ERROR', message: 'Corps JSON illisible.', details: {} } };
  }

  if (status >= 500) {
    req.log.error({ err }, 'Erreur non gérée');
  }
  res.status(status).json(body);
};

function isBodyParserError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type: unknown }).type === 'entity.parse.failed'
  );
}
