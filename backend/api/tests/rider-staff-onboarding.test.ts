import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import { hashOtp } from '../src/modules/auth/otp.service.js';
import {
  riderDocumentSettings,
  defaultRiderDocumentSettings,
  RIDER_DOCUMENTS_KEY,
} from '../src/modules/riders/rider.documents.settings.js';
import { colomboToday } from '../src/modules/riders/rider.documents.js';
import { riderDocumentStore } from '../src/modules/riders/rider.documents.files.js';

/**
 * Rider onboarding by staff (owner, 2026-10-11):
 *   1. "For my number I don't need this": an APPROVED rider never gets the
 *      application / documents screen (ALREADY_APPROVED, code unspent so the
 *      Rider app signs in with it).
 *   2. "Mainly I am going to approve the drivers manually; they will send
 *      docs on WhatsApp": "Riders upload documents in the app"
 *      (applicant_uploads_enabled, default off) and "Documents needed before
 *      approval" (require_documents_for_approval, default on).
 *   3. "Add a delivery rider and I upload the things": POST /admin/riders and
 *      the staff document endpoints (VERIFIED when complete).
 *
 * Own throwaway users (phones +94770009510-9, emails @rider-onboard.blynk.test),
 * files in a temporary directory; every row and file is removed afterwards
 * and the rider_documents setting row is restored.
 */
const PREFIX = '+9477000951';
const local = (n: string) => `077000951${n}`;
const EMAIL_DOMAIN = '@rider-onboard.blynk.test';

const PLAIN_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'),
  Buffer.from([0xff, 0xd9]),
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1')]);
/** A JPEG with an EXIF GPS IFD (latitude bytes 0x11223344). */
function jpegWithGps(): Buffer {
  const tiff = Buffer.alloc(92);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x0002, 28);
  tiff.writeUInt16LE(5, 30);
  tiff.writeUInt32LE(3, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.writeUInt32LE(0, 40);
  for (let i = 0; i < 6; i++) tiff.writeUInt32LE(0x11223344, 44 + i * 4);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(exif.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), len, exif]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xcc, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos]);
}

describe('Rider onboarding by staff (owner, 2026-10-11)', () => {
  const app = createApp();
  const seededPacker = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const ids = { admin: '', ops: '', customer: '', approvedUser: '' };
  const tokens = { admin: '', ops: '', customer: '', packer: generateAccessToken(seededPacker) };
  let tmpRoot = '';
  let savedSetting: { value: unknown; description: string | null } | null = null;
  const originalRead = riderDocumentSettings.read;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const userIds = () => `(SELECT id FROM users WHERE phone LIKE '${PREFIX}%' OR email LIKE '%${EMAIL_DOMAIN}')`;
  const inFuture = (days: number) => DateTime.fromISO(colomboToday()).plus({ days }).toISODate()!;

  async function plantOtp(n: string, code = '135790') {
    await pool.query(`UPDATE otp_verifications SET consumed_at = now() WHERE phone = $1 AND consumed_at IS NULL`, [`${PREFIX}${n}`]);
    await pool.query(
      `INSERT INTO otp_verifications (phone, otp_hash, purpose, attempts_count, max_attempts, expires_at)
       VALUES ($1, $2, 'LOGIN', 0, 5, now() + interval '5 minutes')`,
      [`${PREFIX}${n}`, await hashOtp(code)]
    );
    return code;
  }
  const unspent = async (n: string) =>
    (await pool.query(`SELECT count(*)::int AS n FROM otp_verifications WHERE phone = $1 AND consumed_at IS NULL`, [`${PREFIX}${n}`])).rows[0].n;
  const sessionReq = (n: string, otp: string) => request(app).post('/api/v1/riders/applications/session').send({ phone: local(n), otp });
  const settings = (body: Record<string, unknown>, token = tokens.ops) =>
    request(app).put('/api/v1/admin/settings/rider-documents').set(auth(token)).send(body);
  const addRider = (body: Record<string, unknown>, token = tokens.ops) => request(app).post('/api/v1/admin/riders').set(auth(token)).send(body);
  const staffPut = (riderId: string, type: string, page: number, file: Buffer, opts: { expiry?: string; token?: string; name?: string; ct?: string } = {}) => {
    const r = request(app)
      .put(`/api/v1/admin/riders/${riderId}/documents/${type}/pages/${page}`)
      .set(auth(opts.token ?? tokens.ops));
    if (opts.expiry !== undefined) r.field('expiry_date', opts.expiry);
    return r.attach('file', file, { filename: opts.name ?? 'doc.jpg', contentType: opts.ct ?? 'image/jpeg' });
  };
  const riderOf = async (n: string) =>
    (await pool.query(`SELECT r.*, u.role, u.id AS uid FROM riders r JOIN users u ON u.id = r.user_id WHERE u.phone = $1`, [`${PREFIX}${n}`])).rows[0];
  const docsOf = async (riderId: string) =>
    (await pool.query(`SELECT *, to_char(expiry_date, 'YYYY-MM-DD') AS expiry FROM rider_documents WHERE rider_id = $1 ORDER BY doc_type`, [riderId])).rows;
  const details = (n: string, extra: Record<string, unknown> = {}) => ({
    full_name: `Staff Added ${n}`,
    phone: local(n),
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: `wp-add-${n}`,
    ...extra,
  });

  async function writeSetting(value: Record<string, unknown>) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RIDER_DOCUMENTS_KEY, JSON.stringify({ ...defaultRiderDocumentSettings(), ...value })]
    );
  }

  async function cleanup() {
    const users = userIds();
    const riders = `(SELECT id FROM riders WHERE user_id IN ${users})`;
    await pool.query(
      `DELETE FROM notifications WHERE user_id IN ${users} OR recipient LIKE '${PREFIX}%';
       DELETE FROM audit_logs WHERE entity_id IN ${users} OR entity_id IN ${riders} OR actor_user_id IN ${users}
         OR entity_id IN (SELECT id FROM rider_documents WHERE rider_id IN ${riders} OR draft_phone LIKE '${PREFIX}%');
       DELETE FROM rider_documents WHERE rider_id IN ${riders} OR draft_phone LIKE '${PREFIX}%';
       DELETE FROM riders WHERE user_id IN ${users};
       DELETE FROM refresh_tokens WHERE user_id IN ${users};
       DELETE FROM otp_verifications WHERE phone LIKE '${PREFIX}%';
       DELETE FROM users WHERE id IN ${users};`
    );
  }

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-rider-onboard-'));
    riderDocumentStore.useRoot(tmpRoot);
    riderDocumentSettings.read = () => riderDocumentSettings.realRead();
    const saved = await pool.query(`SELECT value, description FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    savedSetting = saved.rows[0] ?? null;
    await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]); // the defaults
    await cleanup();
    const { rows } = await pool.query<{ id: string; phone: string }>(
      `INSERT INTO users (phone, email, full_name, role) VALUES
         ('${PREFIX}0', 'admin${EMAIL_DOMAIN}', 'RO Admin', 'ADMIN'),
         ('${PREFIX}1', 'ops${EMAIL_DOMAIN}', 'RO Operator', 'OPERATIONS'),
         ('${PREFIX}2', NULL, 'RO Customer', 'CUSTOMER'),
         ('${PREFIX}9', NULL, 'RO Approved Rider', 'RIDER')
       RETURNING id, phone`
    );
    const id = (n: string) => rows.find((r) => r.phone === `${PREFIX}${n}`)!.id;
    Object.assign(ids, { admin: id('0'), ops: id('1'), customer: id('2'), approvedUser: id('9') });
    await pool.query(
      `INSERT INTO riders (user_id, dark_store_id, vehicle_type, vehicle_registration_number, is_active, is_available, approval_status, applied_at)
       VALUES ($1, (SELECT id FROM dark_stores WHERE is_active LIMIT 1), 'MOTORCYCLE', 'WP RO-9', true, true, 'APPROVED', now())`,
      [ids.approvedUser]
    );
    tokens.admin = generateAccessToken({ id: ids.admin, phone: `${PREFIX}0`, role: 'ADMIN' });
    tokens.ops = generateAccessToken({ id: ids.ops, phone: `${PREFIX}1`, role: 'OPERATIONS' });
    tokens.customer = generateAccessToken({ id: ids.customer, phone: `${PREFIX}2`, role: 'CUSTOMER' });
  });

  beforeEach(() => authRateLimiter.reset());

  afterAll(async () => {
    await cleanup();
    if (savedSetting) {
      await pool.query(
        `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description`,
        [RIDER_DOCUMENTS_KEY, JSON.stringify(savedSetting.value), savedSetting.description]
      );
    } else {
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    }
    riderDocumentSettings.read = originalRead;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ==========================================================================
  describe('settings: the two switches', () => {
    it('default: uploads off, documents needed before approval; public flag for the Rider app', async () => {
      const got = await request(app).get('/api/v1/admin/settings/rider-documents').set(auth(tokens.admin));
      expect(got.status).toBe(200);
      expect(got.body.data.settings).toMatchObject({ applicant_uploads_enabled: false, require_documents_for_approval: true });
      const pub = await request(app).get('/api/v1/riders/applications/settings');
      expect(pub.status).toBe(200);
      expect(pub.body.data).toEqual({ applicant_uploads_enabled: false, whatsapp: '+94 71 710 7374' });
    });

    it('a switch is saved alone (documents kept), validated, ADMIN/OPERATIONS only, audited', async () => {
      expect((await settings({ applicant_uploads_enabled: true }, tokens.customer)).status).toBe(403);
      expect((await settings({ applicant_uploads_enabled: true }, tokens.packer)).status).toBe(403);
      const bad = await settings({ applicant_uploads_enabled: 'yes' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.map((d: { field: string }) => d.field)).toContain('applicant_uploads_enabled');

      const on = await settings({ applicant_uploads_enabled: true });
      expect(on.status, JSON.stringify(on.body)).toBe(200);
      expect(on.body.data.settings.applicant_uploads_enabled).toBe(true);
      expect(on.body.data.settings.require_documents_for_approval).toBe(true);
      expect(on.body.data.settings.documents).toHaveLength(4);
      expect((await request(app).get('/api/v1/riders/applications/settings')).body.data.applicant_uploads_enabled).toBe(true);

      const both = await settings({ applicant_uploads_enabled: false, require_documents_for_approval: false }, tokens.admin);
      expect(both.status).toBe(200);
      expect(both.body.data.settings).toMatchObject({ applicant_uploads_enabled: false, require_documents_for_approval: false });
      // Sending the documents list leaves the switches alone.
      const docsOnly = await settings({
        documents: [{ key: 'INSURANCE', enabled: true, required_for: ['MOTORCYCLE'], needs_expiry: true, needs_back: false }],
      });
      expect(docsOnly.status).toBe(200);
      expect(docsOnly.body.data.settings).toMatchObject({ applicant_uploads_enabled: false, require_documents_for_approval: false });

      const audit = await pool.query(
        `SELECT old_values, new_values FROM audit_logs WHERE action = 'RIDER_DOCUMENT_SETTINGS_UPDATED' AND actor_user_id = ANY($1) ORDER BY created_at`,
        [[ids.ops, ids.admin]]
      );
      expect(audit.rows).toHaveLength(3);
      expect(audit.rows[0].old_values.applicant_uploads_enabled).toBe(false);
      expect(audit.rows[0].new_values.applicant_uploads_enabled).toBe(true);
      expect(audit.rows[1].new_values.require_documents_for_approval).toBe(false);
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    });
  });

  // ==========================================================================
  describe('applicants while uploads are off (the default)', () => {
    it('the session says uploads are off; uploads are refused; the application is sent without documents', async () => {
      const otp = await plantOtp('5');
      const s = await sessionReq('5', otp);
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      expect(s.body.data.uploads_enabled).toBe(false);
      const token = s.body.data.applicant_token as string;
      const up = await request(app)
        .put('/api/v1/riders/applications/documents/VEHICLE_BOOK/pages/0')
        .set(auth(token))
        .attach('file', PLAIN_JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
      expect(up.status).toBe(403);
      expect(up.body.error.code).toBe('APPLICANT_UPLOADS_OFF');
      expect(up.body.error.message).toContain('+94 71 710 7374');
      const exp = await request(app).patch('/api/v1/riders/applications/documents/INSURANCE').set(auth(token)).send({ expiry_date: inFuture(100) });
      expect(exp.status).toBe(403);

      const sent = await request(app)
        .post('/api/v1/riders/applications/submit')
        .set(auth(token))
        .send({ full_name: 'No Docs Applicant', vehicle_type: 'MOTORCYCLE', vehicle_registration_number: 'WP ND-5' });
      expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      expect((await riderOf('5')).approval_status).toBe('PENDING');
    });

    it('the old phone + code endpoint needs no documents either', async () => {
      const otp = await plantOtp('6');
      const res = await request(app)
        .post('/api/v1/riders/applications')
        .send({ phone: local('6'), otp, full_name: 'Old Path Applicant', vehicle_type: 'CAR', vehicle_registration_number: 'CAR-6' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it('approval still needs the documents while "Documents needed before approval" is on; off, it does not', async () => {
      const rider = await riderOf('5');
      const refused = await request(app).post(`/api/v1/admin/rider-applications/${rider.id}/approve`).set(auth(tokens.ops)).send({});
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('DOCUMENTS_NOT_VERIFIED');
      await writeSetting({ require_documents_for_approval: false });
      const list = await request(app).get('/api/v1/admin/rider-applications?limit=100').set(auth(tokens.ops));
      const mine = (list.body.data.applications as Array<Record<string, unknown>>).find((a) => a.id === rider.id)!;
      expect(mine).toMatchObject({ documents_verified: true, documents_blocking: [], approval_needs_documents: false });
      const ok = await request(app).post(`/api/v1/admin/rider-applications/${rider.id}/approve`).set(auth(tokens.ops)).send({});
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    });
  });

  // ==========================================================================
  describe('an approved rider never sees the application', () => {
    it('the applicant session is refused (ALREADY_APPROVED) and the code stays usable to sign in', async () => {
      const otp = await plantOtp('9');
      const res = await sessionReq('9', otp);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_APPROVED');
      expect(await unspent('9')).toBe(1);
      const signIn = await request(app).post('/api/v1/auth/otp/verify').send({ phone: local('9'), otp, create_account: false, app: 'rider' });
      expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);
      expect(signIn.body.data.user.role).toBe('RIDER');
    });

    it('even with uploads on, an approved rider cannot upload through an old applicant session', async () => {
      await writeSetting({ applicant_uploads_enabled: true });
      // A session started while the application was still waiting.
      const { signApplicantToken } = await import('../src/modules/riders/rider.documents.js');
      const token = signApplicantToken(`${PREFIX}9`);
      const up = await request(app)
        .put('/api/v1/riders/applications/documents/VEHICLE_BOOK/pages/0')
        .set(auth(token))
        .attach('file', PLAIN_JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' });
      expect(up.status).toBe(409);
      expect(up.body.error.code).toBe('ALREADY_APPROVED');
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    });
  });

  // ==========================================================================
  describe('Add rider (POST /admin/riders)', () => {
    it('validates the body and refuses other roles', async () => {
      expect((await addRider(details('3'), tokens.customer)).status).toBe(403);
      expect((await addRider(details('3'), tokens.packer)).status).toBe(403);
      expect((await request(app).post('/api/v1/admin/riders').send(details('3'))).status).toBe(401);
      const noReg = await addRider(details('3', { vehicle_registration_number: '' }));
      expect(noReg.status).toBe(400);
      expect(noReg.body.error.details.map((d: { field: string }) => d.field)).toContain('vehicle_registration_number');
      const badPhone = await addRider(details('3', { phone: '12345' }));
      expect(badPhone.status).toBe(400);
      const extra = await addRider(details('3', { role: 'ADMIN' }));
      expect(extra.status).toBe(400);
      expect(await riderOf('3')).toBeUndefined();
    });

    it('refuses staff numbers and approved riders', async () => {
      const ops = await addRider(details('1'));
      expect(ops.status).toBe(409);
      expect(ops.body.error.code).toBe('STAFF_CAN_DELIVER');
      const admin = await addRider(details('0'));
      expect(admin.status).toBe(409);
      expect(admin.body.error.code).toBe('PHONE_IN_USE');
      const approved = await addRider(details('9'));
      expect(approved.status).toBe(409);
      expect(approved.body.error.code).toBe('ALREADY_APPROVED');
    });

    it('documents needed: the rider waits; staff upload (VERIFIED when complete); then approval; signs in at once', async () => {
      const res = await addRider(details('3', { pay_type: 'COMMISSION', pay_model: 'FIXED', fixed_lkr: 150 }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ approved: false, from: 'NEW_NUMBER' });
      expect(res.body.data.rider).toMatchObject({ approval_status: 'PENDING', full_name: 'Staff Added 3', vehicle_registration_number: 'WP-ADD-3' });
      expect((res.body.data.documents_blocking as Array<{ key: string }>).map((b) => b.key).sort()).toEqual(
        ['DRIVING_LICENCE', 'INSURANCE', 'REVENUE_LICENCE', 'VEHICLE_BOOK'].sort()
      );
      const riderId = res.body.data.rider.id as string;
      const row = await riderOf('3');
      expect(row).toMatchObject({ id: riderId, role: 'CUSTOMER', pay_type: 'COMMISSION', pay_model: 'FIXED', is_active: false });
      expect(Number(row.pay_fixed_lkr)).toBe(150);

      // Upload pipeline: type sniffing, HEIC, roles, unknown rider/type, expired date.
      expect((await staffPut(riderId, 'VEHICLE_BOOK', 0, Buffer.from('not an image at all'))).status).toBe(415);
      expect((await staffPut(riderId, 'VEHICLE_BOOK', 0, HEIC, { name: 'a.heic', ct: 'image/heic' })).status).toBe(415);
      expect((await staffPut(riderId, 'VEHICLE_BOOK', 0, PLAIN_JPEG, { token: tokens.customer })).status).toBe(403);
      expect((await staffPut('00000000-0000-4000-8000-000000000001', 'VEHICLE_BOOK', 0, PLAIN_JPEG)).status).toBe(404);
      expect((await staffPut(riderId, 'PASSPORT', 0, PLAIN_JPEG)).status).toBe(404);
      expect((await staffPut(riderId, 'DRIVING_LICENCE', 1, PLAIN_JPEG)).status).toBe(400);
      const expired = await staffPut(riderId, 'INSURANCE', 0, PDF, { name: 'i.pdf', ct: 'application/pdf', expiry: inFuture(-1) });
      expect(expired.status).toBe(409);
      expect(expired.body.error.code).toBe('DOCUMENT_EXPIRED');

      // A complete single-page document: VERIFIED by the uploader, GPS stripped, private.
      const vb = await staffPut(riderId, 'VEHICLE_BOOK', 0, jpegWithGps());
      expect(vb.status, JSON.stringify(vb.body)).toBe(200);
      expect(vb.body.data.document).toMatchObject({ doc_type: 'VEHICLE_BOOK', status: 'VERIFIED', reviewed_by_name: 'RO Operator' });
      const stored = (await docsOf(riderId)).find((d) => d.doc_type === 'VEHICLE_BOOK')!;
      expect(stored.reviewed_by).toBe(ids.ops);
      const file = fs.readFileSync(path.join(tmpRoot, stored.images[0].key));
      expect(file.indexOf(Buffer.from([0x44, 0x33, 0x22, 0x11]))).toBe(-1);
      // Needs an expiry date: PENDING until it has one.
      const rl = await staffPut(riderId, 'REVENUE_LICENCE', 0, PLAIN_JPEG);
      expect(rl.body.data.document.status).toBe('PENDING');
      const rlExp = await request(app)
        .patch(`/api/v1/admin/riders/${riderId}/documents/REVENUE_LICENCE`)
        .set(auth(tokens.ops))
        .send({ expiry_date: inFuture(300) });
      expect(rlExp.status).toBe(200);
      expect(rlExp.body.data.document).toMatchObject({ status: 'VERIFIED', expiry_date: inFuture(300) });
      // Expiry sent with the upload.
      const ins = await staffPut(riderId, 'INSURANCE', 0, PDF, { name: 'i.pdf', ct: 'application/pdf', expiry: inFuture(200) });
      expect(ins.body.data.document).toMatchObject({ status: 'VERIFIED', expiry_date: inFuture(200) });
      // Front + back: PENDING after the front, VERIFIED with the back; removing the back sends it back to PENDING.
      expect((await staffPut(riderId, 'DRIVING_LICENCE', 0, PLAIN_JPEG, { expiry: inFuture(400) })).body.data.document.status).toBe('PENDING');
      expect((await staffPut(riderId, 'DRIVING_LICENCE', 1, PLAIN_JPEG)).body.data.document.status).toBe('VERIFIED');
      const removed = await request(app).delete(`/api/v1/admin/riders/${riderId}/documents/DRIVING_LICENCE/pages/1`).set(auth(tokens.ops));
      expect(removed.status).toBe(200);
      expect(removed.body.data.document).toMatchObject({ status: 'PENDING' });
      expect(removed.body.data.document.pages).toHaveLength(1);
      expect((await staffPut(riderId, 'DRIVING_LICENCE', 1, PLAIN_JPEG)).body.data.document.status).toBe('VERIFIED');

      const review = await request(app).get(`/api/v1/admin/riders/${riderId}/documents`).set(auth(tokens.ops));
      expect(review.body.data).toMatchObject({ all_required_verified: true, blocking: [], approval_needs_documents: true });

      const approve = await request(app).post(`/api/v1/admin/rider-applications/${riderId}/approve`).set(auth(tokens.ops)).send({});
      expect(approve.status, JSON.stringify(approve.body)).toBe(200);
      const after = await riderOf('3');
      expect(after).toMatchObject({ approval_status: 'APPROVED', role: 'RIDER', is_active: true, pay_type: 'COMMISSION', pay_model: 'FIXED' });

      // The rider signs in to the Rider app with the phone at once.
      const otp = await plantOtp('3');
      const signIn = await request(app).post('/api/v1/auth/otp/verify').send({ phone: local('3'), otp, create_account: false, app: 'rider' });
      expect(signIn.status, JSON.stringify(signIn.body)).toBe(200);

      const audit = await pool.query(
        `SELECT action, count(*)::int AS n FROM audit_logs
          WHERE actor_user_id = $1 AND (entity_id = $2 OR entity_id IN (SELECT id FROM rider_documents WHERE rider_id = $2))
          GROUP BY action ORDER BY action`,
        [ids.ops, riderId]
      );
      expect(audit.rows).toEqual([
        { action: 'RIDER_APPROVED', n: 1 },
        { action: 'RIDER_CREATED_BY_STAFF', n: 1 },
        { action: 'RIDER_DOCUMENT_EXPIRY_SET_BY_STAFF', n: 1 },
        { action: 'RIDER_DOCUMENT_PAGE_REMOVED_BY_STAFF', n: 1 },
        { action: 'RIDER_DOCUMENT_UPLOADED_BY_STAFF', n: 6 },
      ]);
    });

    it('staff replace an approved rider\'s renewed document (stays VERIFIED with the new date)', async () => {
      const riderId = (await riderOf('3')).id as string;
      const oldKey = (await docsOf(riderId)).find((d) => d.doc_type === 'INSURANCE')!.images[0].key as string;
      const res = await staffPut(riderId, 'INSURANCE', 0, PLAIN_JPEG, { expiry: inFuture(500) });
      expect(res.status).toBe(200);
      expect(res.body.data.document).toMatchObject({ status: 'VERIFIED', expiry_date: inFuture(500) });
      expect(fs.existsSync(path.join(tmpRoot, oldKey))).toBe(false);
    });

    it('nothing blocking: approved at once (account RIDER, approval SMS queued)', async () => {
      await writeSetting({ require_documents_for_approval: false });
      const res = await addRider(details('4', { vehicle_type: 'BICYCLE', vehicle_registration_number: '', emergency_contact_phone: '0771234567' }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ approved: true, documents_blocking: [] });
      expect(res.body.data.rider).toMatchObject({ approval_status: 'APPROVED', vehicle_registration_number: null, emergency_contact_phone: '+94771234567' });
      const row = await riderOf('4');
      expect(row).toMatchObject({ role: 'RIDER', is_active: true, pay_type: 'COMPANY' });
      const sms = await pool.query(`SELECT notification_type FROM notifications WHERE user_id = $1`, [row.uid]);
      expect(sms.rows.map((r) => r.notification_type)).toEqual(['RIDER_APPROVED']);
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    });

    it('a customer\'s number is attached to the same account (one number = one account)', async () => {
      const res = await addRider(details('2', { vehicle_type: 'BICYCLE', vehicle_registration_number: null }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // A bicycle needs no documents by default: approved at once.
      expect(res.body.data).toMatchObject({ approved: true, from: 'CUSTOMER' });
      expect(res.body.data.rider.user_id).toBe(ids.customer);
      const row = await riderOf('2');
      expect(row).toMatchObject({ uid: ids.customer, role: 'RIDER' });
      expect((await pool.query(`SELECT full_name FROM users WHERE id = $1`, [ids.customer])).rows[0].full_name).toBe('Staff Added 2');
    });

    it('a waiting applicant is taken over; staff upload over their own document verifies it', async () => {
      // Applicant 7 applies with uploads on and one document of their own.
      await writeSetting({ applicant_uploads_enabled: true, documents: defaultRiderDocumentSettings().documents.map((d) => ({ ...d, required_for: [] })) });
      const otp = await plantOtp('7');
      const token = (await sessionReq('7', otp)).body.data.applicant_token as string;
      expect(
        (
          await request(app)
            .put('/api/v1/riders/applications/documents/VEHICLE_BOOK/pages/0')
            .set(auth(token))
            .attach('file', PLAIN_JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
        ).status
      ).toBe(200);
      expect(
        (await request(app).post('/api/v1/riders/applications/submit').set(auth(token)).send({ full_name: 'Waiting 7', vehicle_type: 'SCOOTER', vehicle_registration_number: 'SC-7' })).status
      ).toBe(201);
      await writeSetting({}); // defaults again: four documents required for a scooter
      const applicant = await riderOf('7');
      expect((await docsOf(applicant.id))[0].status).toBe('PENDING');
      const res = await addRider(details('7', { vehicle_type: 'SCOOTER', vehicle_registration_number: 'SC-77' }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ approved: false, from: 'APPLICATION' });
      expect(res.body.data.rider.id).toBe(applicant.id);
      expect(res.body.data.rider.vehicle_registration_number).toBe('SC-77');
      const vb = await staffPut(applicant.id, 'VEHICLE_BOOK', 0, PLAIN_JPEG, { token: tokens.admin });
      expect(vb.body.data.document).toMatchObject({ status: 'VERIFIED', reviewed_by_name: 'RO Admin' });
      await pool.query(`DELETE FROM system_configurations WHERE key = $1`, [RIDER_DOCUMENTS_KEY]);
    });
  });
});
