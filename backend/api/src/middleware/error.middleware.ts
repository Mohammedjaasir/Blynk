import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(message: string, statusCode: number = 500, code: string = 'INTERNAL_SERVER_ERROR', details: unknown = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function errorMiddleware(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.id || 'unknown';
  const timestamp = new Date().toISOString();

  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred';
  let details: unknown = null;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if ('name' in err && err.name === 'ZodError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = (err as unknown as { errors: unknown }).errors;
  } else if ('type' in err && err.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'MALFORMED_JSON';
    message = 'Malformed JSON body in request';
  } else if ('status' in err && typeof err.status === 'number') {
    statusCode = err.status;
    message = err.message;
  }

  // Log error internally with requestId (hide stack traces from client in production)
  if (statusCode >= 500) {
    logger.error(
      {
        err,
        requestId,
        url: req.originalUrl,
        method: req.method,
      },
      `Internal Server Error: ${err.message}`
    );
  } else {
    logger.warn(
      {
        code,
        statusCode,
        requestId,
        url: req.originalUrl,
        method: req.method,
        details,
      },
      `Client error: ${message}`
    );
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
      timestamp,
      requestId,
      ...(env.NODE_ENV === 'development' && statusCode >= 500 ? { stack: err.stack } : {}),
    },
  });
}

export function notFoundMiddleware(req: Request, res: Response): void {
  const requestId = req.id || 'unknown';
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      details: null,
      timestamp: new Date().toISOString(),
      requestId,
    },
  });
}
