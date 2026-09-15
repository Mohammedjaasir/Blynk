import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.middleware.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';

describe('Validation Middleware', () => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());

  const SampleSchema = {
    body: z.object({
      phone: z.string().min(10),
      quantity: z.number().int().positive(),
    }),
  };

  app.post('/test-validation', validate(SampleSchema), (req, res) => {
    res.json({ success: true, data: req.body });
  });

  app.use(errorMiddleware);

  it('accepts valid payloads', async () => {
    const res = await request(app)
      .post('/test-validation')
      .send({ phone: '+94771234567', quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quantity).toBe(2);
  });

  it('rejects invalid payload with standardized 400 and validation error codes', async () => {
    const res = await request(app)
      .post('/test-validation')
      .send({ phone: 'short', quantity: -1 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBe(2);
  });
});
