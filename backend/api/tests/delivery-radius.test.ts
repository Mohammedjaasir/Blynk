import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * Delivery radius (owner's brother, 2026-10-25): an Admin / Ops setting, not a constant - 4 km now, 6 km
 * next week to add Beruwala. It is the active store's radius_km; the address book and checkout refuse
 * anything further out, and GET /store (the customer app's delivery-area map) follows it.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RAD-');
const people = customerFixtures(app, { idPrefix: 'c0c00065', phoneBase: '+947096500', name: 'Radius Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

let storeId = '';
let original = 0;
let lat = 0;
let lng = 0;
let testStart: Date;

const patch = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/delivery-radius').set(auth(token)).send(body);

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  const store = (await pool.query('SELECT id, radius_km, latitude, longitude FROM dark_stores WHERE is_active = true ORDER BY created_at ASC LIMIT 1')).rows[0];
  storeId = store.id;
  original = Number(store.radius_km);
  lat = Number(store.latitude);
  lng = Number(store.longitude);
});

afterAll(async () => {
  await pool.query('UPDATE dark_stores SET radius_km = $2 WHERE id = $1', [storeId, original]);
  await people.cleanup();
  await fx.cleanup();
  await pool.query("DELETE FROM audit_logs WHERE action = 'DELIVERY_RADIUS_UPDATED' AND created_at >= $1", [testStart]);
});

describe('Delivery radius setting', () => {
  it('reads the store radius, saves a new one with an audit entry, and the public store follows', async () => {
    const got = await request(app).get('/api/v1/admin/settings/delivery-radius').set(auth(opsToken));
    expect(got.status).toBe(200);
    expect(got.body.data.radius_km).toBe(original);
    expect(typeof got.body.data.store_name).toBe('string');

    const res = await patch({ radius_km: 6 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.radius_km).toBe(6);
    expect((await request(app).get('/api/v1/store')).body.data.radius_km).toBe(6);
    expect(Number((await pool.query('SELECT radius_km FROM dark_stores WHERE id = $1', [storeId])).rows[0].radius_km)).toBe(6);

    const audit = (await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'DELIVERY_RADIUS_UPDATED' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(audit.old_values).toEqual({ key: 'delivery_radius', radius_km: original });
    expect(audit.new_values).toEqual({ key: 'delivery_radius', radius_km: 6 });

    expect((await patch({ radius_km: 4 })).body.data.radius_km).toBe(4);
  });

  it('validates the number and the role', async () => {
    expect((await patch({ radius_km: 0.4 })).status).toBe(400);
    expect((await patch({ radius_km: 51 })).status).toBe(400);
    expect((await patch({ radius_km: 4.123 })).status).toBe(400);
    expect((await patch({ radius_km: '6' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ radius_km: 6, extra: 1 })).status).toBe(400);
    expect((await patch({ radius_km: 6 }, tokens.staff)).status).toBe(403);
    expect((await patch({ radius_km: 6 }, tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/delivery-radius')).status).toBe(401);
  });

  it('an address 5 km out is refused at 4 km and accepted at 6 km', async () => {
    // ~5 km due north of the store (1 degree of latitude is ~111.2 km).
    const north = { latitude: lat + 5 / 111.2, longitude: lng };
    const me = await people.customer(1);
    const save = () =>
      request(app)
        .post('/api/v1/me/addresses')
        .set(auth(me.token))
        .send({ label: 'Far', recipient_name: 'Far', recipient_phone: '077 123 4567', address_line1: '1 Far Road', city: 'Beruwala', ...north });

    expect((await patch({ radius_km: 4 })).status).toBe(200);
    const refused = await save();
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
    expect(refused.body.error.details.max_radius_km).toBe(4);

    expect((await patch({ radius_km: 6 })).status).toBe(200);
    const accepted = await save();
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect((await patch({ radius_km: 4 })).status).toBe(200);
  });
});
