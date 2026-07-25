import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error & { status?: number; statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  // Respect the status attached by upstream middleware (body-parser sets 400
  // for malformed JSON, 413 for entity-too-large). Default to 500 otherwise.
  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : 500;

  res.status(status).json({
    // Client errors carry a safe, descriptive message; server errors stay opaque.
    error: status < 500 ? err.message || 'Bad request' : 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}
