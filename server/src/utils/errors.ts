export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);

export const unauthorized = (message = 'You need to sign in to continue.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have permission to do that.') =>
  new AppError(403, 'forbidden', message);

/** Also used for resources owned by another organisation, so their existence is not revealed. */
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);

export const conflict = (message: string) => new AppError(409, 'conflict', message);

export const serviceUnavailable = (message: string) =>
  new AppError(503, 'service_unavailable', message);
