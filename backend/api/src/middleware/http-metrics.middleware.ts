import { Request, Response, NextFunction } from 'express';
import { metrics } from '../utils/metrics.js';

/**
 * HTTP metrics middleware.
 *
 * Counts every inbound request and classifies the final response
 * status into 2xx / 4xx / 5xx buckets.
 *
 * Must be registered BEFORE route handlers so that `requestsTotal`
 * is always incremented, and AFTER `requestIdMiddleware` so the
 * request context is already populated.
 *
 * The `res.on('finish')` hook fires after the response has been
 * flushed to the client, ensuring accurate status classification.
 */
export function httpMetricsMiddleware(_req: Request, res: Response, next: NextFunction): void {
  metrics.incrementRequestsTotal();

  res.on('finish', () => {
    const status = res.statusCode;
    if (status >= 200 && status < 400) {
      metrics.incrementRequests2xx();
    } else if (status >= 400 && status < 500) {
      metrics.incrementRequests4xx();
      metrics.incrementClientErrors();
    } else if (status >= 500) {
      metrics.incrementRequests5xx();
      metrics.incrementServerErrors();
    }
  });

  next();
}
