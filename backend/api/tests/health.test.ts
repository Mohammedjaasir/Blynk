import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Health and System Routes', () => {
  const app = createApp();

  it('GET /health returns 200/503 with standardized status structure', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBeOneOf([200, 503]);
    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('version', '1.0.0');
    expect(res.body.data).toHaveProperty('database');
    expect(res.body.data.database).toHaveProperty('status');
  });

  it('GET /ready returns 200 OK with process uptime and ready status', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ready');
    expect(typeof res.body.data.uptime).toBe('number');
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('GET /unknown-route returns standardized 404 error format', async () => {
    const res = await request(app).get('/api/v1/non-existent-route-for-testing');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error).toHaveProperty('requestId');
    expect(res.body.error).toHaveProperty('timestamp');
  });
});
