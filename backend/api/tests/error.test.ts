import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { AppError, errorMiddleware } from '../src/middleware/error.middleware.js';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';

describe('Standardized Error Format', () => {
  const app = express();
  app.use(requestIdMiddleware);

  app.get('/test-app-error', (_req, _res, next) => {
    next(new AppError('Item is currently out of stock', 422, 'ITEM_UNAVAILABLE', { sku: 'SKU-001' }));
  });

  app.get('/test-unexpected-error', (_req, _res, next) => {
    next(new Error('Unexpected unhandled crash'));
  });

  app.use(errorMiddleware);

  it('formats custom AppError in standardized RFC-7807 inspired envelope', async () => {
    const res = await request(app).get('/test-app-error');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('ITEM_UNAVAILABLE');
    expect(res.body.error.message).toBe('Item is currently out of stock');
    expect(res.body.error.details).toEqual({ sku: 'SKU-001' });
    expect(res.body.error).toHaveProperty('timestamp');
    expect(res.body.error).toHaveProperty('requestId');
  });

  it('masks unhandled 500 error messages for client security', async () => {
    const res = await request(app).get('/test-unexpected-error');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.body.error.message).toBe('An unexpected internal server error occurred');
  });
});
