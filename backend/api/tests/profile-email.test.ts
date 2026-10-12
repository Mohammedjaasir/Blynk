import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * PATCH /me `email` (security audit 2026-10): customers only (staff emails
 * change on the audited Staff page), stored lower-case, and an address
 * already in use gets one uniform 409 EMAIL_UNAVAILABLE, never a 500.
 *
 * Own throwaway users: customers c0c000e1-..., one OPERATIONS and one RIDER
 * on +9477093199x, emails @profile-email.blynk.test.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c000e1', phoneBase: '+947709310', name: 'Profile Email Customer' });
const DOMAIN = '@profile-email.blynk.test';
const STAFF = [
  { phone: '+94770931991', role: 'OPERATIONS' as const, email: `ops${DOMAIN}` },
  { phone: '+94770931992', role: 'RIDER' as const, email: null },
];
const staffTokens: Record<string, { id: string; token: string }> = {};

const patchMe = (token: string, body: object) =>
  request(app).patch('/api/v1/me').set('Authorization', `Bearer ${token}`).send(body);

async function purgeStaff() {
  await pool.query('DELETE FROM users WHERE phone = ANY($1)', [STAFF.map((s) => s.phone)]);
}

beforeAll(async () => {
  await people.purge(3);
  await purgeStaff();
  for (const s of STAFF) {
    const id = (
      await pool.query(`INSERT INTO users (phone, full_name, role, email) VALUES ($1, 'PE Staff', $2, $3) RETURNING id`, [
        s.phone,
        s.role,
        s.email,
      ])
    ).rows[0].id as string;
    staffTokens[s.role] = { id, token: generateAccessToken({ id, phone: s.phone, role: s.role }) };
  }
});

afterAll(async () => {
  await people.cleanup();
  await purgeStaff();
});

describe('PATCH /me email', () => {
  it('staff cannot change their email here: 403 STAFF_EMAIL_MANAGED, nothing changes', async () => {
    for (const role of ['OPERATIONS', 'RIDER'] as const) {
      const res = await patchMe(staffTokens[role].token, { email: `new-${role.toLowerCase()}${DOMAIN}` });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.error.code).toBe('STAFF_EMAIL_MANAGED');
      expect(res.body.error.message).toMatch(/Staff page/);
    }
    const ops = (await pool.query('SELECT email FROM users WHERE id = $1', [staffTokens.OPERATIONS.id])).rows[0];
    expect(ops.email).toBe(`ops${DOMAIN}`);
    // Other fields still save for staff.
    expect((await patchMe(staffTokens.OPERATIONS.token, { full_name: 'PE Staff Renamed' })).status).toBe(200);
  });

  it('a customer email is stored lower-case', async () => {
    const c = await people.customer(1);
    const res = await patchMe(c.token, { email: `  Mixed.Case${DOMAIN.toUpperCase()} ` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await pool.query('SELECT email FROM users WHERE id = $1', [c.id])).rows[0].email).toBe(`mixed.case${DOMAIN}`);
  });

  it('an email already in use (any case, staff included) is one uniform 409 EMAIL_UNAVAILABLE', async () => {
    const c = await people.customer(2);
    const other = await people.customer(3);
    await pool.query('UPDATE users SET email = $2 WHERE id = $1', [other.id, `taken${DOMAIN}`]);

    const staffEmail = await patchMe(c.token, { email: `OPS${DOMAIN}` });
    const customerEmail = await patchMe(c.token, { email: `taken${DOMAIN}` });
    for (const res of [staffEmail, customerEmail]) {
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_UNAVAILABLE');
    }
    expect(staffEmail.body.error.message).toBe(customerEmail.body.error.message);
    expect((await pool.query('SELECT email FROM users WHERE id = $1', [c.id])).rows[0].email).toBeNull();
  });
});
