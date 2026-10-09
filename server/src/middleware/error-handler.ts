import type { ApiErrorBody } from '@habitat/shared';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(_req: Request, res: Response) {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'Not found.' } };
  res.status(404).json(body);
}

// Express identifies error handlers by arity, so all four parameters are required.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
    };
    return res.status(err.status).json(body);
  }

  // Errors raised by middleware: body-parser (malformed JSON, too large), express.static (404)
  const status = (err as { status?: number; type?: string })?.status;
  if (status && status >= 400 && status < 500) {
    const type = (err as { type?: string }).type;
    const [code, message] =
      status === 404
        ? ['not_found', 'Not found.']
        : type === 'entity.too.large'
          ? ['payload_too_large', 'Request body is too large.']
          : ['bad_request', 'Malformed request.'];
    const body: ApiErrorBody = { error: { code, message } };
    return res.status(status).json(body);
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
  const body: ApiErrorBody = {
    error: {
      code: 'internal_error',
      // Never expose internals in production.
      message:
        env.isProduction || !(err instanceof Error)
          ? 'Something went wrong on our side. Please try again.'
          : err.message,
    },
  };
  res.status(500).json(body);
}
