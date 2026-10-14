import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { LocalDiskStorage } from '../src/utils/storage.js';
import { previewRemoveProductImages, removeAllProductImages } from '../src/modules/catalog/catalog.remove-images.js';
import { tokens, auth, users } from './helpers/stock.js';

/**
 * Remove all product images (owner, 2026-10-14). The real action clears every
 * product in the database, so the service runs here inside a transaction
 * that is ALWAYS rolled back, against a temporary MEDIA_ROOT - no real row or
 * file is changed. Over HTTP only the refusals and the read-only preview are
 * exercised (never a confirmed POST).
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const stamp = Date.now();
const BASE = 'http://media.test';
let tmp = '';
let outsideFile = '';

class Rollback extends Error {}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-media-'));
  fs.mkdirSync(path.join(tmp, 'products'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'categories'), { recursive: true });
  for (const f of ['products/a.webp', 'products/combo.webp', 'products/shared-cat.webp', 'products/doc.webp', 'categories/c.webp', 'products/unrelated.webp']) {
    fs.writeFileSync(path.join(tmp, f), 'x');
  }
  outsideFile = path.join(path.dirname(tmp), `blynk-outside-${stamp}.txt`);
  fs.writeFileSync(outsideFile, 'must survive');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outsideFile, { force: true });
});

const url = (key: string) => `${BASE}/uploads/${key}`;
const exists = (key: string) => fs.existsSync(path.join(tmp, key));

describe('Remove all product images (service, rolled back, temp MEDIA_ROOT)', () => {
  it('clears every product and combo image, deletes only unshared product files, audits, and is idempotent', async () => {
    const storage = new LocalDiskStorage(tmp, '/uploads', BASE);
    let checked = false;
    await db
      .transaction()
      .execute(async (trx) => {
        const cat = await trx
          .insertInto('categories')
          .values({ name: `RI cat ${stamp}`, slug: `ri-cat-${stamp}`, image_url: url('categories/c.webp') })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('categories')
          .values({ name: `RI cat2 ${stamp}`, slug: `ri-cat2-${stamp}`, image_url: url('products/shared-cat.webp') })
          .execute();
        await trx
          .insertInto('doctors')
          .values({ full_name: `Dr RI ${stamp}`, specialty: 'Orthodontist', photo_url: url('products/doc.webp') } as never)
          .execute();
        const product = (n: string, image: string | null) => ({
          category_id: cat.id,
          name: `RI ${n} ${stamp}`,
          slug: `ri-${n}-${stamp}`,
          sku: `T-RI-${n}-${stamp}`,
          unit: '1 pc',
          purchase_cost: 10,
          image_url: image,
          image_focal_x: 20,
          image_focal_y: 80,
        });
        await trx
          .insertInto('products')
          .values([
            product('a', url('products/a.webp')),
            product('b', url('products/a.webp')), // the same file twice
            product('ext', 'https://cdn.example.com/x.jpg'), // not ours: only unlinked
            product('shared', url('products/shared-cat.webp')), // a category uses it too
            product('doc', url('products/doc.webp')), // a doctor photo uses it too
            product('gone', url('products/missing.webp')), // file already gone
            product('escape', `${BASE}/uploads/products/../../${path.basename(outsideFile)}`), // never followed
            product('cat', url('categories/c.webp')), // a category file: not under products/
          ])
          .execute();
        await trx.insertInto('combos').values({ name: `RI combo ${stamp}`, price: 100, image_url: url('products/combo.webp') }).execute();

        const preview = await previewRemoveProductImages({ executor: trx, storage });
        expect(preview.products).toBeGreaterThanOrEqual(8);
        expect(preview.combos).toBeGreaterThanOrEqual(1);
        expect(preview.files).toBeGreaterThanOrEqual(5); // a, shared-cat, doc, missing, combo
        expect(preview.files_on_disk).toBeGreaterThanOrEqual(4);
        expect(preview.external_links).toBeGreaterThanOrEqual(3); // ext, escape, categories/c

        const result = await removeAllProductImages({ actorId: users.admin.id }, { executor: trx, storage });
        expect(result.products_cleared).toBe(preview.products);
        expect(result.combos_cleared).toBe(preview.combos);
        expect(result.files_deleted).toBeGreaterThanOrEqual(2);
        expect(result.files_kept_in_use).toBeGreaterThanOrEqual(2);

        // Links cleared everywhere, focal points back to the centre.
        const left = await trx.selectFrom('products').select('id').where('image_url', 'is not', null).execute();
        expect(left).toHaveLength(0);
        const mine = await trx.selectFrom('products').select(['image_focal_x', 'image_focal_y']).where('sku', 'like', `T-RI-%-${stamp}`).execute();
        expect(mine.every((p) => p.image_focal_x === 50 && p.image_focal_y === 50)).toBe(true);
        expect(await trx.selectFrom('combos').select('id').where('image_url', 'is not', null).execute()).toHaveLength(0);

        // Files: product-only ones gone; shared, category, unreferenced and outside ones kept.
        expect(exists('products/a.webp')).toBe(false);
        expect(exists('products/combo.webp')).toBe(false);
        expect(exists('products/shared-cat.webp')).toBe(true);
        expect(exists('products/doc.webp')).toBe(true);
        expect(exists('categories/c.webp')).toBe(true);
        expect(exists('products/unrelated.webp')).toBe(true);
        expect(fs.existsSync(outsideFile)).toBe(true);
        // Category, doctor images untouched.
        const cat2 = await trx.selectFrom('categories').select('image_url').where('slug', '=', `ri-cat2-${stamp}`).executeTakeFirstOrThrow();
        expect(cat2.image_url).toBe(url('products/shared-cat.webp'));

        const audit = await trx
          .selectFrom('audit_logs')
          .select(['action', 'new_values', 'actor_user_id'])
          .where('action', '=', 'PRODUCT_IMAGES_REMOVED_ALL')
          .orderBy('created_at', 'desc')
          .executeTakeFirstOrThrow();
        expect(audit.actor_user_id).toBe(users.admin.id);
        expect(audit.new_values).toMatchObject({ products_cleared: result.products_cleared, files_deleted: result.files_deleted });

        const again = await removeAllProductImages({ actorId: users.admin.id }, { executor: trx, storage });
        expect(again).toEqual({ products_cleared: 0, combos_cleared: 0, files_deleted: 0, files_missing: 0, files_kept_in_use: 0 });
        expect(await previewRemoveProductImages({ executor: trx, storage })).toMatchObject({ products: 0, combos: 0, files: 0 });
        checked = true;
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
    expect(checked).toBe(true);
    // Rolled back: none of this file's rows exist.
    expect(await db.selectFrom('products').select('id').where('sku', 'like', `T-RI-%-${stamp}`).execute()).toHaveLength(0);
  });

  it('the storage helper never resolves a key outside MEDIA_ROOT', async () => {
    const storage = new LocalDiskStorage(tmp, '/uploads', BASE);
    expect(await storage.exists(`../${path.basename(outsideFile)}`)).toBe(false);
    await storage.delete(`../${path.basename(outsideFile)}`);
    await storage.delete(`products/../../${path.basename(outsideFile)}`);
    await storage.delete('');
    expect(fs.existsSync(outsideFile)).toBe(true);
    expect(fs.existsSync(tmp)).toBe(true);
  });
});

describe('Remove all product images (HTTP)', () => {
  it('is ADMIN only: Operations, customers and others get 403; anonymous 401', async () => {
    for (const token of [opsToken, tokens.customer, tokens.rider, tokens.staff]) {
      expect((await request(app).get('/api/v1/admin/products/remove-images/preview').set(auth(token))).status).toBe(403);
      // Wrong word on purpose: even a role slip could never run it here.
      expect((await request(app).post('/api/v1/admin/products/remove-images').set(auth(token)).send({ confirm: 'nope' })).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/products/remove-images/preview')).status).toBe(401);
  });

  it('refuses without the typed word REMOVE (400) and changes nothing', async () => {
    const before = await db.selectFrom('products').select((eb) => eb.fn.countAll<string>().as('n')).where('image_url', 'is not', null).executeTakeFirstOrThrow();
    for (const body of [{}, { confirm: 'remove' }, { confirm: 'REMOVE ' }, { confirm: true }]) {
      const res = await request(app).post('/api/v1/admin/products/remove-images').set(auth(tokens.admin)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const after = await db.selectFrom('products').select((eb) => eb.fn.countAll<string>().as('n')).where('image_url', 'is not', null).executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it('the preview (dry run) gives the counts and writes nothing', async () => {
    const res = await request(app).get('/api/v1/admin/products/remove-images/preview').set(auth(tokens.admin));
    expect(res.status).toBe(200);
    for (const k of ['products', 'combos', 'files', 'files_on_disk', 'external_links']) expect(typeof res.body.data[k]).toBe('number');
  });
});
