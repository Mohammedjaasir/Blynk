import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { env } from '../src/config/env.js';

/**
 * Home promotions + admin media uploads.
 *
 * These cover the contract the Blynk Ops app and the customer carousel both
 * depend on: admin-only mutations, active-only customer reads, display
 * ordering, and image handling.
 */
describe('Admin Promotions & Media Module', () => {
  const app = createApp();

  const adminToken = generateAccessToken({
    id: 'a0000001-0000-0000-0000-000000000003',
    phone: '+94775551122',
    role: 'ADMIN',
  });

  const customerToken = generateAccessToken({
    id: 'a0000001-0000-0000-0000-000000000001',
    phone: '+94771234567',
    role: 'CUSTOMER',
  });

  const createdIds: string[] = [];
  const uploadedKeys: string[] = [];

  // A real 1x1 PNG, so the upload path exercises magic-number sniffing.
  const pngFixture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  beforeAll(async () => {
    await pool.query(`DELETE FROM promotions WHERE title LIKE 'TEST-PROMO%'`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM promotions WHERE title LIKE 'TEST-PROMO%'`);
    for (const key of uploadedKeys) {
      fs.rmSync(path.join(env.MEDIA_ROOT, key), { force: true });
    }
  });

  async function createPromotion(body: Record<string, unknown>) {
    const res = await request(app)
      .post('/api/v1/admin/promotions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    if (res.body?.data?.promotion?.id) createdIds.push(res.body.data.promotion.id);
    return res;
  }

  // ==========================================================================
  // 1. AUTHORIZATION
  // ==========================================================================
  describe('RBAC', () => {
    it('rejects an anonymous request to create a promotion', async () => {
      const res = await request(app)
        .post('/api/v1/admin/promotions')
        .send({ title: 'TEST-PROMO anonymous' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects a customer token on every admin promotion route', async () => {
      const auth = { Authorization: `Bearer ${customerToken}` };

      const create = await request(app)
        .post('/api/v1/admin/promotions')
        .set(auth)
        .send({ title: 'TEST-PROMO customer' });
      const list = await request(app).get('/api/v1/admin/promotions').set(auth);
      const update = await request(app)
        .patch('/api/v1/admin/promotions/00000000-0000-0000-0000-000000000000')
        .set(auth)
        .send({ is_active: false });
      const reorder = await request(app)
        .patch('/api/v1/admin/promotions/reorder')
        .set(auth)
        .send({ items: [{ id: '00000000-0000-0000-0000-000000000000', display_order: 1 }] });
      const remove = await request(app)
        .delete('/api/v1/admin/promotions/00000000-0000-0000-0000-000000000000')
        .set(auth);

      for (const res of [create, list, update, reorder, remove]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('rejects a customer token on media upload and delete', async () => {
      const upload = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${customerToken}`)
        .attach('file', pngFixture, 'x.png');
      const remove = await request(app)
        .delete('/api/v1/admin/media')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ url: 'http://localhost:4000/uploads/products/x.png' });

      expect(upload.status).toBe(403);
      expect(remove.status).toBe(403);
    });
  });

  // ==========================================================================
  // 2. CRUD
  // ==========================================================================
  describe('Promotion CRUD (admin)', () => {
    it('creates a promotion and returns it', async () => {
      const res = await createPromotion({
        title: 'TEST-PROMO create',
        subtitle: 'Created by the test suite',
        display_order: 5,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.promotion.title).toBe('TEST-PROMO create');
      expect(res.body.data.promotion.is_active).toBe(true);
      expect(res.body.data.promotion.display_order).toBe(5);
    });

    it('rejects a promotion whose destination has no value or label', async () => {
      const missingValue = await createPromotion({
        title: 'TEST-PROMO bad destination',
        cta_label: 'Shop',
        cta_destination_type: 'CATEGORY',
      });
      const missingLabel = await createPromotion({
        title: 'TEST-PROMO bad label',
        cta_destination_type: 'CATALOG',
      });

      expect(missingValue.status).toBe(400);
      expect(missingLabel.status).toBe(400);
    });

    it('updates a promotion', async () => {
      const created = await createPromotion({ title: 'TEST-PROMO update' });
      const id = created.body.data.promotion.id;

      const res = await request(app)
        .patch(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'TEST-PROMO updated', subtitle: 'New subtitle' });

      expect(res.status).toBe(200);
      expect(res.body.data.promotion.title).toBe('TEST-PROMO updated');
      expect(res.body.data.promotion.subtitle).toBe('New subtitle');
    });

    it('returns 404 for a promotion that does not exist', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/promotions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PROMOTION_NOT_FOUND');
    });

    it('deletes a promotion', async () => {
      const created = await createPromotion({ title: 'TEST-PROMO delete' });
      const id = created.body.data.promotion.id;

      const res = await request(app)
        .delete(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      const after = await request(app)
        .get(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(after.status).toBe(404);
    });
  });

  // ==========================================================================
  // 3. WHAT THE CUSTOMER RECEIVES
  // ==========================================================================
  describe('Customer promotions API (GET /api/v1/promotions)', () => {
    it('returns only active promotions, in display order', async () => {
      const second = await createPromotion({
        title: 'TEST-PROMO second',
        display_order: 20,
      });
      const first = await createPromotion({
        title: 'TEST-PROMO first',
        display_order: 10,
      });
      const hidden = await createPromotion({
        title: 'TEST-PROMO hidden',
        display_order: 15,
        is_active: false,
      });

      const res = await request(app).get('/api/v1/promotions');
      expect(res.status).toBe(200);

      const titles = res.body.data.promotions.map((p: { title: string }) => p.title);
      expect(titles).toContain('TEST-PROMO first');
      expect(titles).toContain('TEST-PROMO second');
      expect(titles).not.toContain('TEST-PROMO hidden');
      expect(titles.indexOf('TEST-PROMO first')).toBeLessThan(
        titles.indexOf('TEST-PROMO second')
      );

      // Deactivating removes it from the customer payload.
      await request(app)
        .patch(`/api/v1/admin/promotions/${first.body.data.promotion.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_active: false });

      const after = await request(app).get('/api/v1/promotions');
      const afterTitles = after.body.data.promotions.map(
        (p: { title: string }) => p.title
      );
      expect(afterTitles).not.toContain('TEST-PROMO first');

      expect(second.status).toBe(201);
      expect(hidden.status).toBe(201);
    });

    it('reflects an admin reorder', async () => {
      const a = await createPromotion({ title: 'TEST-PROMO order-a', display_order: 30 });
      const b = await createPromotion({ title: 'TEST-PROMO order-b', display_order: 31 });

      const reorder = await request(app)
        .patch('/api/v1/admin/promotions/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [
            { id: a.body.data.promotion.id, display_order: 31 },
            { id: b.body.data.promotion.id, display_order: 30 },
          ],
        });
      expect(reorder.status).toBe(200);

      const res = await request(app).get('/api/v1/promotions');
      const titles = res.body.data.promotions.map((p: { title: string }) => p.title);
      expect(titles.indexOf('TEST-PROMO order-b')).toBeLessThan(
        titles.indexOf('TEST-PROMO order-a')
      );
    });

    it('never exposes internal bookkeeping fields', async () => {
      const res = await request(app).get('/api/v1/promotions');
      for (const promotion of res.body.data.promotions) {
        expect(promotion).not.toHaveProperty('is_active');
        expect(promotion).not.toHaveProperty('created_at');
        expect(promotion).not.toHaveProperty('updated_at');
      }
    });
  });

  // ==========================================================================
  // 3b. BACKGROUND CONTROL
  // ==========================================================================
  describe('Promotion backgrounds', () => {
    it('defaults to SOLID with no colour', async () => {
      const res = await createPromotion({ title: 'TEST-PROMO bg default' });

      expect(res.status).toBe(201);
      expect(res.body.data.promotion.background_type).toBe('SOLID');
      expect(res.body.data.promotion.background_color).toBeNull();
    });

    it('stores a solid colour', async () => {
      const res = await createPromotion({
        title: 'TEST-PROMO bg solid',
        background_type: 'SOLID',
        background_color: '#FFE141',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.promotion.background_color).toBe('#FFE141');
    });

    it('stores a gradient and requires both colours', async () => {
      const incomplete = await createPromotion({
        title: 'TEST-PROMO bg half gradient',
        background_type: 'GRADIENT',
        background_color: '#FFE141',
      });
      expect(incomplete.status).toBe(400);

      const complete = await createPromotion({
        title: 'TEST-PROMO bg gradient',
        background_type: 'GRADIENT',
        background_color: '#FFE141',
        background_color_end: '#FFF8E1',
      });
      expect(complete.status).toBe(201);
      expect(complete.body.data.promotion.background_color_end).toBe('#FFF8E1');
    });

    it('requires an image for an image background', async () => {
      const res = await createPromotion({
        title: 'TEST-PROMO bg image missing',
        background_type: 'IMAGE',
      });

      expect(res.status).toBe(400);
    });

    it('rejects a colour that is not a hex value', async () => {
      const res = await createPromotion({
        title: 'TEST-PROMO bg bad colour',
        background_type: 'SOLID',
        background_color: 'rebeccapurple',
      });

      expect(res.status).toBe(400);
    });

    it('keeps a partial update consistent', async () => {
      const created = await createPromotion({
        title: 'TEST-PROMO bg partial',
        background_type: 'SOLID',
        background_color: '#FFE141',
      });
      const id = created.body.data.promotion.id;

      // Switching to GRADIENT without an end colour must not be accepted.
      const bad = await request(app)
        .patch(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ background_type: 'GRADIENT' });
      expect(bad.status).toBe(400);

      const good = await request(app)
        .patch(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ background_type: 'GRADIENT', background_color_end: '#FFF8E1' });
      expect(good.status).toBe(200);
      expect(good.body.data.promotion.background_type).toBe('GRADIENT');
    });

    // ------------------------------------------------------------------
    // ARTWORK: a finished banner the operator uploads as-is. Same storage
    // as IMAGE; what changes is that the app draws no scrim, headline or
    // subtitle over it.
    // ------------------------------------------------------------------
    it('round-trips an ARTWORK background through create, admin read and the customer feed', async () => {
      const created = await createPromotion({
        title: 'TEST-PROMO bg artwork',
        background_type: 'ARTWORK',
        background_image_url: 'http://localhost:4000/uploads/promotions/banner.png',
        is_active: true,
      });

      expect(created.status).toBe(201);
      expect(created.body.data.promotion.background_type).toBe('ARTWORK');
      expect(created.body.data.promotion.background_image_url).toBe(
        'http://localhost:4000/uploads/promotions/banner.png'
      );

      // The widened CHECK constraint really accepted the row: it is readable
      // back out of PostgreSQL, not just echoed by the handler.
      const id = created.body.data.promotion.id;
      const readBack = await request(app)
        .get(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(readBack.status).toBe(200);
      expect(readBack.body.data.promotion.background_type).toBe('ARTWORK');

      const customer = await request(app).get('/api/v1/promotions');
      const promotion = customer.body.data.promotions.find(
        (p: { title: string }) => p.title === 'TEST-PROMO bg artwork'
      );
      expect(promotion).toBeDefined();
      expect(promotion.background_type).toBe('ARTWORK');
      expect(promotion.background_image_url).toBe(
        'http://localhost:4000/uploads/promotions/banner.png'
      );
    });

    it('requires an image for an ARTWORK background', async () => {
      const res = await createPromotion({
        title: 'TEST-PROMO bg artwork missing',
        background_type: 'ARTWORK',
      });

      expect(res.status).toBe(400);
    });

    it('rejects switching an existing promotion to ARTWORK with no image', async () => {
      const created = await createPromotion({
        title: 'TEST-PROMO bg artwork switch',
        background_type: 'SOLID',
        background_color: '#FFE141',
      });
      const id = created.body.data.promotion.id;

      const bad = await request(app)
        .patch(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ background_type: 'ARTWORK' });
      expect(bad.status).toBe(400);

      const good = await request(app)
        .patch(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          background_type: 'ARTWORK',
          background_image_url: 'http://localhost:4000/uploads/promotions/banner2.png',
        });
      expect(good.status).toBe(200);
      expect(good.body.data.promotion.background_type).toBe('ARTWORK');
    });

    it('title stays required for ARTWORK - it is the accessibility and admin-list label', async () => {
      const res = await createPromotion({
        background_type: 'ARTWORK',
        background_image_url: 'http://localhost:4000/uploads/promotions/banner.png',
      });

      expect(res.status).toBe(400);
    });

    it('lets ARTWORK carry a destination with no button label, but no other type', async () => {
      // The banner draws its own call to action, so the customer app makes
      // the whole card tappable rather than stamping a pill over the artwork.
      const artwork = await createPromotion({
        title: 'TEST-PROMO artwork tappable card',
        background_type: 'ARTWORK',
        background_image_url: 'http://localhost:4000/uploads/promotions/banner3.png',
        cta_destination_type: 'CATALOG',
      });
      expect(artwork.status).toBe(201);
      expect(artwork.body.data.promotion.cta_label).toBeNull();
      expect(artwork.body.data.promotion.cta_destination_type).toBe('CATALOG');

      // Unchanged for every pre-existing type: without a label there would be
      // nothing on the card to press.
      const solid = await createPromotion({
        title: 'TEST-PROMO solid no label',
        background_type: 'SOLID',
        background_color: '#FFE141',
        cta_destination_type: 'CATALOG',
      });
      expect(solid.status).toBe(400);
    });

    it('still rejects a background_type outside the widened set', async () => {
      const res = await createPromotion({
        title: 'TEST-PROMO bg unknown',
        background_type: 'HOLOGRAM',
      });

      expect(res.status).toBe(400);
    });

    it('migration 008 down refuses to run while ARTWORK rows exist, rather than dropping them', async () => {
      // Narrowing the CHECK under live data would either fail opaquely or
      // silently rewrite finished banners back to scrimmed IMAGE cards. The
      // rollback is supposed to stop and name the rows instead.
      const down = fs.readFileSync(
        path.join(process.cwd(), 'src/database/migrations/008_promotion_artwork_background_down.sql'),
        'utf-8'
      );

      const client = await pool.connect();
      try {
        // Everything here is rolled back; the live schema is untouched.
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO promotions (title, background_type, background_image_url)
           VALUES ('TEST-PROMO rollback guard', 'ARTWORK', 'http://localhost:4000/uploads/promotions/guard.png')`
        );

        await expect(client.query(down)).rejects.toThrow(/ARTWORK/);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('sends the background to the customer app', async () => {
      await createPromotion({
        title: 'TEST-PROMO bg customer',
        background_type: 'GRADIENT',
        background_color: '#0C831F',
        background_color_end: '#5FBF6E',
        is_active: true,
      });

      const res = await request(app).get('/api/v1/promotions');
      const promotion = res.body.data.promotions.find(
        (p: { title: string }) => p.title === 'TEST-PROMO bg customer'
      );

      expect(promotion).toBeDefined();
      expect(promotion.background_type).toBe('GRADIENT');
      expect(promotion.background_color).toBe('#0C831F');
      expect(promotion.background_color_end).toBe('#5FBF6E');
      expect(promotion.background_image_url).toBeNull();
    });
  });

  // ==========================================================================
  // 3c. BACKGROUND FOCAL POINT (migration 009)
  // ==========================================================================
  // The card is a fixed shape and the background fills it with `cover`, so
  // the part that does not fit is cropped - from the CENTRE, until now. A
  // banner whose "Super Market" headline runs along the top lost exactly that
  // headline. These two percentages move the crop's anchor instead.
  //
  // Purely additive: 50/50 IS the centre, so an untouched promotion renders
  // precisely as it did before 009.
  describe('Promotion background focal point', () => {
    const BANNER = 'http://localhost:4000/uploads/promotions/supermarket.png';

    it('defaults to 50/50 - the centre - when the operator never touches it', async () => {
      const res = await createPromotion({ title: 'TEST-PROMO focal default' });

      expect(res.status).toBe(201);
      expect(res.body.data.promotion.background_focal_x).toBe(50);
      expect(res.body.data.promotion.background_focal_y).toBe(50);
    });

    it('round-trips a stored focal point through create, admin read and the customer feed', async () => {
      const created = await createPromotion({
        title: 'TEST-PROMO focal roundtrip',
        background_type: 'ARTWORK',
        background_image_url: BANNER,
        // The real case: keep the top of the banner, where the wording is.
        background_focal_x: 50,
        background_focal_y: 8,
        is_active: true,
      });

      expect(created.status).toBe(201);
      expect(created.body.data.promotion.background_focal_y).toBe(8);

      const id = created.body.data.promotion.id;
      const readBack = await request(app)
        .get(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(readBack.status).toBe(200);
      expect(readBack.body.data.promotion.background_focal_x).toBe(50);
      expect(readBack.body.data.promotion.background_focal_y).toBe(8);

      const customer = await request(app).get('/api/v1/promotions');
      const promotion = customer.body.data.promotions.find(
        (p: { title: string }) => p.title === 'TEST-PROMO focal roundtrip'
      );
      expect(promotion).toBeDefined();
      expect(promotion.background_focal_x).toBe(50);
      expect(promotion.background_focal_y).toBe(8);
    });

    it('applies to an IMAGE background too, not only ARTWORK', async () => {
      const created = await createPromotion({
        title: 'TEST-PROMO focal image',
        background_type: 'IMAGE',
        background_image_url: BANNER,
        background_focal_x: 80,
        background_focal_y: 20,
      });

      expect(created.status).toBe(201);
      expect(created.body.data.promotion.background_focal_x).toBe(80);
      expect(created.body.data.promotion.background_focal_y).toBe(20);
    });

    it('accepts the extremes and stays re-adjustable', async () => {
      const created = await createPromotion({
        title: 'TEST-PROMO focal extremes',
        background_type: 'ARTWORK',
        background_image_url: BANNER,
        background_focal_x: 0,
        background_focal_y: 100,
      });
      expect(created.status).toBe(201);
      expect(created.body.data.promotion.background_focal_x).toBe(0);
      expect(created.body.data.promotion.background_focal_y).toBe(100);

      const moved = await request(app)
        .patch(`/api/v1/admin/promotions/${created.body.data.promotion.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ background_focal_x: 50, background_focal_y: 50 });
      expect(moved.status).toBe(200);
      expect(moved.body.data.promotion.background_focal_x).toBe(50);
      expect(moved.body.data.promotion.background_focal_y).toBe(50);
    });

    it('rejects a focal point outside 0-100, or one that is not a whole percentage', async () => {
      const tooHigh = await createPromotion({
        title: 'TEST-PROMO focal too high',
        background_focal_x: 101,
      });
      const negative = await createPromotion({
        title: 'TEST-PROMO focal negative',
        background_focal_y: -5,
      });
      const fractional = await createPromotion({
        title: 'TEST-PROMO focal fractional',
        background_focal_x: 12.5,
      });
      const notANumber = await createPromotion({
        title: 'TEST-PROMO focal text',
        background_focal_y: 'top',
      });

      for (const res of [tooHigh, negative, fractional, notANumber]) {
        expect(res.status).toBe(400);
      }
      expect(tooHigh.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an out-of-range focal point on update and leaves the stored value alone', async () => {
      const created = await createPromotion({ title: 'TEST-PROMO focal update guard' });
      const id = created.body.data.promotion.id;

      const bad = await request(app)
        .patch(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ background_focal_y: 140 });
      expect(bad.status).toBe(400);

      const after = await request(app)
        .get(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(after.body.data.promotion.background_focal_y).toBe(50);
    });

    it('a promotion created before 009 is unaffected: the column default is the centre', async () => {
      // Insert exactly as a pre-009 row would have been written - naming no
      // focal column at all - and it must come back at the centre, which is
      // the crop it already had.
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO promotions (title, background_type, background_image_url)
         VALUES ('TEST-PROMO focal legacy', 'IMAGE', $1)
         RETURNING id`,
        [BANNER]
      );
      const id = rows[0]!.id;

      const res = await request(app)
        .get(`/api/v1/admin/promotions/${id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.promotion.background_focal_x).toBe(50);
      expect(res.body.data.promotion.background_focal_y).toBe(50);
    });
  });

  // ==========================================================================
  // 4. MEDIA
  // ==========================================================================
  describe('Admin media upload', () => {
    it('stores an image and serves it back', async () => {
      const res = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('folder', 'promotions')
        .attach('file', pngFixture, 'promo.png');

      expect(res.status).toBe(201);
      const { key, url } = res.body.data.media;
      uploadedKeys.push(key);

      expect(key).toMatch(/^promotions\//);
      expect(url).toContain('/uploads/promotions/');
      expect(fs.existsSync(path.join(env.MEDIA_ROOT, key))).toBe(true);

      const served = await request(app).get(`/uploads/${key}`);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toContain('image/png');
    });

    it('rejects a non-image file', async () => {
      const res = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from('definitely not an image'), 'notes.txt');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects an image renamed to look like a PNG', async () => {
      const res = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', Buffer.from('<?php echo 1; ?>'), {
          filename: 'evil.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects an unknown folder', async () => {
      const res = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('folder', '../secrets')
        .attach('file', pngFixture, 'promo.png');

      expect(res.status).toBe(400);
    });

    it('deletes a stored image', async () => {
      const upload = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('folder', 'products')
        .attach('file', pngFixture, 'product.png');
      const { key, url } = upload.body.data.media;

      const res = await request(app)
        .delete('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ url });

      expect(res.status).toBe(200);
      expect(fs.existsSync(path.join(env.MEDIA_ROOT, key))).toBe(false);
    });

    it('keeps an image file while another promotion still uses it; removes it once nothing does', async () => {
      const upload = await request(app)
        .post('/api/v1/admin/media')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('folder', 'promotions')
        .attach('file', pngFixture, 'shared.png');
      const { key, url } = upload.body.data.media;
      uploadedKeys.push(key);
      const file = path.join(env.MEDIA_ROOT, key);

      const a = await createPromotion({ title: 'TEST-PROMO shared image A', image_url: url });
      const b = await createPromotion({ title: 'TEST-PROMO shared image B', image_url: url });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);

      // Deleting A: B still shows the file, so it stays.
      await request(app)
        .delete(`/api/v1/admin/promotions/${a.body.data.promotion.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(fs.existsSync(file)).toBe(true);

      // Replacing B's image: nothing references the file any more.
      await request(app)
        .patch(`/api/v1/admin/promotions/${b.body.data.promotion.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ image_url: null })
        .expect(200);
      expect(fs.existsSync(file)).toBe(false);
    });
  });
});
