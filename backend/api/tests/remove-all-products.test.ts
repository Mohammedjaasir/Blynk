import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { sql, type Transaction } from 'kysely';
import { createApp } from '../src/app.js';
import { db } from '../src/database/connection.js';
import type { Database } from '../src/database/types.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { LocalDiskStorage } from '../src/utils/storage.js';
import { previewRemoveAllProducts, removeAllProducts } from '../src/modules/catalog/catalog.remove-products.js';
import { orderRepository } from '../src/modules/orders/order.repository.js';
import { lockStockRows, recordStockMovement, stockKeyOf } from '../src/modules/inventory/stock-ledger.js';
import { tokens, auth, users, STORE } from './helpers/stock.js';

/**
 * Remove all products (owner, 2026-10-14). The real action soft-deletes every
 * product in the database, so - like remove-product-images.test.ts - the
 * service runs here inside a transaction that is ALWAYS rolled back, against
 * a temporary MEDIA_ROOT: no real row or file changes. Over HTTP only the
 * refusals and the read-only preview are exercised (never a confirmed POST).
 */
const app = createApp();
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const stamp = Date.now();
const BASE = 'http://media.test';
let tmp = '';

class Rollback extends Error {}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-media-'));
  fs.mkdirSync(path.join(tmp, 'products'), { recursive: true });
  for (const f of ['products/rap-plain.webp', 'products/rap-combo.webp']) fs.writeFileSync(path.join(tmp, f), 'x');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const url = (key: string) => `${BASE}/uploads/${key}`;
const exists = (key: string) => fs.existsSync(path.join(tmp, key));

/** Rolled back no matter what; `body` runs inside the transaction. */
async function inRollback(body: (trx: Transaction<Database>) => Promise<void>) {
  let checked = false;
  await db
    .transaction()
    .execute(async (trx) => {
      await body(trx);
      checked = true;
      throw new Rollback();
    })
    .catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });
  expect(checked).toBe(true);
  expect(await db.selectFrom('products').select('id').where('sku', 'like', `T-RAP-%-${stamp}%`).execute()).toHaveLength(0);
}

async function fixtures(trx: Transaction<Database>) {
  const cat = await trx
    .insertInto('categories')
    .values({ name: `RAP cat ${stamp}`, slug: `rap-cat-${stamp}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  const product = (n: string, image: string | null = null) => ({
    category_id: cat.id,
    name: `RAP ${n} ${stamp}`,
    slug: `rap-${n}-${stamp}`,
    sku: `T-RAP-${n}-${stamp}`,
    unit: '1 pc',
    purchase_cost: 80,
    image_url: image,
  });
  const rows = await trx
    .insertInto('products')
    .values([
      product('open', null), // in an open order, tracked stock
      product('done', null), // in a delivered order only
      product('plain', url('products/rap-plain.webp')),
      product('var', null), // has variants
      product('alert', null), // a customer waits for it
    ])
    .returning(['id', 'sku'])
    .execute();
  const id = (n: string) => rows.find((r) => r.sku === `T-RAP-${n}-${stamp}`)!.id;
  const p = { open: id('open'), done: id('done'), plain: id('plain'), var: id('var'), alert: id('alert') };

  const variants = await trx
    .insertInto('product_variants')
    .values([
      { product_id: p.var, label: '100 g', sku: `T-RAP-var100-${stamp}`, purchase_cost: 50 },
      { product_id: p.var, label: '250 g', sku: `T-RAP-var250-${stamp}`, purchase_cost: 110 },
    ])
    .returning(['id', 'label'])
    .execute();
  const v100 = variants.find((v) => v.label === '100 g')!.id;

  // Tracked stock for the open order's product and for the variant.
  await trx
    .insertInto('inventory')
    .values([
      { dark_store_id: STORE, product_id: p.open, tracking_mode: 'TRACKED', quantity_on_hand: 10 },
      { dark_store_id: STORE, product_id: p.var, variant_id: v100, tracking_mode: 'TRACKED', quantity_on_hand: 5 },
    ])
    .execute();

  // An open combo holding two of them, one already switched off.
  const combo = await trx
    .insertInto('combos')
    .values({ name: `RAP combo ${stamp}`, price: 300, image_url: url('products/rap-combo.webp') })
    .returning('id')
    .executeTakeFirstOrThrow();
  const offCombo = await trx
    .insertInto('combos')
    .values({ name: `RAP off combo ${stamp}`, price: 300, is_active: false })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('combo_items')
    .values([
      { combo_id: combo.id, product_id: p.plain, quantity: 1 },
      { combo_id: combo.id, product_id: p.var, variant_id: v100, quantity: 2 },
      { combo_id: offCombo.id, product_id: p.plain, quantity: 2 },
    ])
    .execute();

  // Banners: one active on a product (switched off), one already off on a
  // product (left alone), one on a category (left alone).
  const promos = await trx
    .insertInto('promotions')
    .values([
      { title: `RAP promo product ${stamp}`, cta_destination_type: 'PRODUCT', cta_destination_value: p.plain, is_active: true },
      { title: `RAP promo off ${stamp}`, cta_destination_type: 'PRODUCT', cta_destination_value: p.alert, is_active: false },
      { title: `RAP promo cat ${stamp}`, cta_destination_type: 'CATEGORY', cta_destination_value: `rap-cat-${stamp}`, is_active: true },
    ])
    .returning(['id', 'title'])
    .execute();
  const promo = (t: string) => promos.find((r) => r.title === `RAP promo ${t} ${stamp}`)!.id;

  await trx.insertInto('stock_alerts').values({ user_id: users.customer.id, product_id: p.alert }).execute();

  // Orders: PLACED (open) with a plain line and a variant line; DELIVERED.
  const order = async (status: string, lines: Array<{ product: string; variant?: string; label?: string }>) => {
    const o = await sql<{ id: string }>`
      INSERT INTO orders (order_number, idempotency_key, customer_id, dark_store_id, order_status, subtotal_amount, delivery_fee, total_amount,
                          delivery_recipient_name, delivery_recipient_phone, delivery_address_line1, delivery_city, delivery_latitude, delivery_longitude, placed_at)
      VALUES (${`TST-RAP-${status}-${stamp}`}, ${`tst-rap-${status}-${stamp}`}, ${users.customer.id}, ${STORE}, ${status}, ${200 * lines.length}, 100, ${200 * lines.length + 100},
              'RAP Test', '+94770000000', 'No. 1, Test Lane', 'Dharga Town', '6.500000', '80.000000', now())
      RETURNING id`.execute(trx);
    const orderId = o.rows[0]!.id;
    for (const l of lines) {
      await sql`
        INSERT INTO order_items (order_id, product_id, variant_id, variant_label_snapshot, product_name_snapshot, sku_snapshot, unit_snapshot,
                                 unit_selling_price, estimated_unit_cost, markup_percentage_applied, quantity, subtotal)
        VALUES (${orderId}, ${l.product}, ${l.variant ?? null}, ${l.label ?? null}, (SELECT name FROM products WHERE id = ${l.product}),
                (SELECT sku FROM products WHERE id = ${l.product}), '1 pc', 200, 80, 25, 1, 200)`.execute(trx);
    }
    return orderId;
  };
  const openOrder = await order('PLACED', [{ product: p.open }, { product: p.var, variant: v100, label: '100 g' }]);
  await order('DELIVERED', [{ product: p.done }]);

  return { cat: cat.id, p, v100, combo: combo.id, offCombo: offCombo.id, promo, openOrder };
}

describe('Remove all products (service, rolled back, temp MEDIA_ROOT)', () => {
  it('previews, soft-deletes everything with its variants, switches off combos and banners, clears alerts and images, audits, and is idempotent', async () => {
    const storage = new LocalDiskStorage(tmp, '/uploads', BASE);
    await inRollback(async (trx) => {
      const fx = await fixtures(trx);
      const liveBefore = Number(
        (await trx.selectFrom('products').select((eb) => eb.fn.countAll<string>().as('n')).where('deleted_at', 'is', null).executeTakeFirstOrThrow()).n
      );
      const categoriesBefore = await trx.selectFrom('categories').select('id').where('deleted_at', 'is', null).execute();

      const preview = await previewRemoveAllProducts({ executor: trx, storage });
      expect(preview.products).toBe(liveBefore);
      expect(preview.products).toBeGreaterThanOrEqual(5);
      expect(preview.variants).toBeGreaterThanOrEqual(2);
      expect(preview.products_with_images).toBeGreaterThanOrEqual(1);
      expect(preview.combos).toBeGreaterThanOrEqual(1);
      expect(preview.promotions).toBeGreaterThanOrEqual(1);
      expect(preview.stock_alerts).toBeGreaterThanOrEqual(1);
      expect(preview.open_orders).toBeGreaterThanOrEqual(1);
      expect(preview.products_in_open_orders).toBeGreaterThanOrEqual(2);
      expect(preview.images.files).toBeGreaterThanOrEqual(2);
      // The preview writes nothing.
      expect(await trx.selectFrom('products').select('id').where('id', '=', fx.p.plain).where('deleted_at', 'is', null).execute()).toHaveLength(1);

      const result = await removeAllProducts({ actorId: users.admin.id }, { alsoRemoveImages: true }, { executor: trx, storage });
      expect(result.products_removed).toBe(preview.products);
      expect(result.variants_removed).toBe(preview.variants);
      expect(result.combos_switched_off).toBe(preview.combos);
      expect(result.promotions_switched_off).toBe(preview.promotions);
      expect(result.stock_alerts_cleared).toBe(preview.stock_alerts);
      expect(result.open_orders_kept).toBe(preview.open_orders);
      expect(result.images).not.toBeNull();
      expect(result.images!.files_deleted).toBeGreaterThanOrEqual(2);

      // Soft-deleted, never hard-deleted: every row is still there, hidden.
      const mine = await trx
        .selectFrom('products')
        .select(['id', 'deleted_at', 'is_active', 'is_available', 'image_url'])
        .where('category_id', '=', fx.cat)
        .execute();
      expect(mine).toHaveLength(5);
      expect(mine.every((r) => r.deleted_at !== null && !r.is_active && !r.is_available && r.image_url === null)).toBe(true);
      expect(await trx.selectFrom('products').select('id').where('deleted_at', 'is', null).execute()).toHaveLength(0);
      expect(await trx.selectFrom('v_product_catalog').select('id').execute()).toHaveLength(0);
      const variants = await trx.selectFrom('product_variants').select(['deleted_at', 'is_active']).where('product_id', '=', fx.p.var).execute();
      expect(variants).toHaveLength(2);
      expect(variants.every((v) => v.deleted_at !== null && !v.is_active)).toBe(true);

      // Combos: the active one is off (items kept), its image cleared and file gone.
      const combo = await trx.selectFrom('combos').select(['is_active', 'deleted_at', 'image_url']).where('id', '=', fx.combo).executeTakeFirstOrThrow();
      expect(combo).toMatchObject({ is_active: false, deleted_at: null, image_url: null });
      expect(await trx.selectFrom('combo_items').select('id').where('combo_id', '=', fx.combo).execute()).toHaveLength(2);
      expect(exists('products/rap-plain.webp')).toBe(false);
      expect(exists('products/rap-combo.webp')).toBe(false);

      // Banners: the product one is off; the category one and the already-off one untouched.
      const promo = async (t: string) =>
        trx.selectFrom('promotions').select(['is_active', 'cta_destination_type', 'cta_destination_value']).where('id', '=', fx.promo(t)).executeTakeFirstOrThrow();
      expect(await promo('product')).toMatchObject({ is_active: false, cta_destination_type: 'PRODUCT', cta_destination_value: fx.p.plain });
      expect(await promo('off')).toMatchObject({ is_active: false });
      expect(await promo('cat')).toMatchObject({ is_active: true, cta_destination_type: 'CATEGORY' });

      expect(await trx.selectFrom('stock_alerts').select('id').where('product_id', '=', fx.p.alert).execute()).toHaveLength(0);
      // Categories untouched.
      expect(await trx.selectFrom('categories').select('id').where('deleted_at', 'is', null).execute()).toHaveLength(categoriesBefore.length);

      // The open order is intact and readable with its snapshots...
      const order = await orderRepository.findOrderById(fx.openOrder, undefined, trx);
      expect(order).not.toBeNull();
      expect(order!.order_status).toBe('PLACED');
      const items = (order as unknown as { items: Array<{ product_id: string; product_name_snapshot: string; variant_id: string | null; variant_label_snapshot: string | null }> }).items;
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.product_name_snapshot).sort()).toEqual([`RAP open ${stamp}`, `RAP var ${stamp}`]);
      expect(items.find((i) => i.variant_id)!.variant_label_snapshot).toBe('100 g');
      // ...and can still be packed: its stock rows resolve and take the units.
      const keys = [
        { product_id: fx.p.open, variant_id: null },
        { product_id: fx.p.var, variant_id: fx.v100 },
      ];
      const locked = await lockStockRows(trx, STORE, keys);
      expect(locked.size).toBe(2);
      for (const key of keys) {
        const moved = await recordStockMovement(trx, {
          inventory: locked.get(stockKeyOf(key))!,
          delta: -1,
          type: 'ORDER_FULFILLMENT',
          orderId: fx.openOrder,
          actorId: users.admin.id,
          notes: 'RAP pack after removal',
        });
        expect(moved.inventory.quantity_on_hand).toBe(key.variant_id ? 4 : 9);
      }

      // The same SKUs, slugs and variant SKUs can be uploaded again.
      const again = await trx
        .insertInto('products')
        .values({ category_id: fx.cat, name: `RAP plain ${stamp}`, slug: `rap-plain-${stamp}`, sku: `T-RAP-plain-${stamp}`, unit: '1 pc', purchase_cost: 90 })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('product_variants').values({ product_id: again.id, label: '100 g', sku: `T-RAP-var100-${stamp}`, purchase_cost: 50 }).execute();
      expect(await trx.selectFrom('v_product_catalog').select('sku').where('sku', '=', `T-RAP-plain-${stamp}`).execute()).toHaveLength(1);

      // Audited once with the counts.
      const audits = await trx
        .selectFrom('audit_logs')
        .select(['new_values', 'actor_user_id'])
        .where('action', '=', 'PRODUCTS_REMOVED_ALL')
        .where('created_at', '>=', sql<Date>`now()`)
        .execute();
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actor_user_id).toBe(users.admin.id);
      expect(audits[0]!.new_values).toMatchObject({ products_removed: result.products_removed, also_remove_images: true });
      expect(
        await trx.selectFrom('audit_logs').select('id').where('action', '=', 'PRODUCT_IMAGES_REMOVED_ALL').where('created_at', '>=', sql<Date>`now()`).execute()
      ).toHaveLength(0);

      // Idempotent (the re-uploaded product aside, which a second run would remove).
      await trx.updateTable('products').set({ deleted_at: new Date() }).where('id', '=', again.id).execute();
      const second = await removeAllProducts({ actorId: users.admin.id }, {}, { executor: trx, storage });
      expect(second).toMatchObject({
        products_removed: 0,
        variants_removed: 0,
        combos_switched_off: 0,
        promotions_switched_off: 0,
        stock_alerts_cleared: 0,
        open_orders_kept: 0,
        images: { products_cleared: 0, combos_cleared: 0, files_deleted: 0 },
      });
      expect(await previewRemoveAllProducts({ executor: trx, storage })).toMatchObject({ products: 0, variants: 0, combos: 0, promotions: 0, open_orders: 0 });
    });
  });

  it('also_remove_images=false keeps every image link and file', async () => {
    const storage = new LocalDiskStorage(tmp, '/uploads', BASE);
    fs.writeFileSync(path.join(tmp, 'products/rap-plain.webp'), 'x');
    fs.writeFileSync(path.join(tmp, 'products/rap-combo.webp'), 'x');
    await inRollback(async (trx) => {
      const fx = await fixtures(trx);
      const result = await removeAllProducts({ actorId: users.admin.id }, { alsoRemoveImages: false }, { executor: trx, storage });
      expect(result.images).toBeNull();
      expect(result.products_removed).toBeGreaterThanOrEqual(5);
      const plain = await trx.selectFrom('products').select(['image_url', 'deleted_at']).where('id', '=', fx.p.plain).executeTakeFirstOrThrow();
      expect(plain.deleted_at).not.toBeNull();
      expect(plain.image_url).toBe(url('products/rap-plain.webp'));
      expect(exists('products/rap-plain.webp')).toBe(true);
      expect(exists('products/rap-combo.webp')).toBe(true);
    });
  });
});

describe('Remove all products (HTTP)', () => {
  it('is ADMIN only: Operations, customers and others get 403; anonymous 401', async () => {
    for (const token of [opsToken, tokens.customer, tokens.rider, tokens.staff]) {
      expect((await request(app).get('/api/v1/admin/products/remove-all/preview').set(auth(token))).status).toBe(403);
      // Wrong words on purpose: even a role slip could never run it here.
      expect((await request(app).post('/api/v1/admin/products/remove-all').set(auth(token)).send({ confirm: 'nope' })).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/products/remove-all/preview')).status).toBe(401);
    expect((await request(app).post('/api/v1/admin/products/remove-all').send({ confirm: 'nope' })).status).toBe(401);
  });

  it('refuses without the exact words DELETE ALL PRODUCTS (400) and changes nothing', async () => {
    const live = () => db.selectFrom('products').select((eb) => eb.fn.countAll<string>().as('n')).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    const before = await live();
    for (const body of [
      {},
      { confirm: 'REMOVE' },
      { confirm: 'delete all products' },
      { confirm: 'DELETE ALL PRODUCTS ' },
      { confirm: true },
      { confirm: 'nope', also_remove_images: false },
      { confirm: 'DELETE ALL PRODUCTS', also_remove_images: 'yes' }, // bad flag: refused before anything runs
    ]) {
      const res = await request(app).post('/api/v1/admin/products/remove-all').set(auth(tokens.admin)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await live()).n).toBe(before.n);
  });

  it('the preview (dry run) gives the counts and writes nothing', async () => {
    const res = await request(app).get('/api/v1/admin/products/remove-all/preview').set(auth(tokens.admin));
    expect(res.status).toBe(200);
    for (const k of ['products', 'variants', 'products_with_images', 'combos', 'promotions', 'banners_linked', 'stock_alerts', 'open_orders', 'products_in_open_orders']) {
      expect(typeof res.body.data[k], k).toBe('number');
    }
    for (const k of ['products', 'combos', 'files', 'files_on_disk', 'external_links']) expect(typeof res.body.data.images[k]).toBe('number');
  });
});
