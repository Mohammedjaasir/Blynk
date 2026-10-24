import { pool } from '../../src/database/connection.js';
import { generateAccessToken } from '../../src/modules/auth/token.service.js';

/**
 * Seller-portal fixtures for the staff-side tests (admin-seller-*.test.ts): sellers (with their
 * SELLER user), submissions inserted directly, a test category - all with a per-file stamp and
 * removed again by cleanup(), together with everything the approvals created from them
 * (products, inventory, notifications, audit rows).
 */
export interface FixtureSeller {
  id: string;
  userId: string;
  phone: string;
  shop: string;
  token: string;
}

export function sellerFixtures(tag: string) {
  const stamp = Date.now();
  let seq = 0;
  let testStart: Date;
  let categoryId = '';
  let otherCategoryId = '';
  const sellers: FixtureSeller[] = [];

  async function setup() {
    testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
    categoryId = (
      await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`SF ${tag} ${stamp}`, `sf-${tag}-${stamp}`])
    ).rows[0].id;
    otherCategoryId = (
      await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`SF other ${tag} ${stamp}`, `sf-other-${tag}-${stamp}`])
    ).rows[0].id;
  }

  async function seller(
    opts: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; commission?: number; shop?: string } = {}
  ): Promise<FixtureSeller> {
    seq += 1;
    const phone = `+9476${String(stamp).slice(-5)}${String(seq).padStart(2, '0')}`;
    const shop = opts.shop ?? `SF Shop ${tag} ${stamp} ${seq}`;
    const userId = (
      await pool.query(`INSERT INTO users (phone, full_name, role) VALUES ($1, $2, 'SELLER') RETURNING id`, [phone, `Owner ${seq}`])
    ).rows[0].id as string;
    const id = (
      await pool.query(
        `INSERT INTO sellers (user_id, shop_name, status, commission_percent) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, shop, opts.status ?? 'APPROVED', opts.commission ?? 0]
      )
    ).rows[0].id as string;
    const s = { id, userId, phone, shop, token: generateAccessToken({ id: userId, phone, role: 'SELLER' }) };
    sellers.push(s);
    return s;
  }

  /** A submission the way the seller API stores it. */
  async function submission(
    sellerId: string,
    opts: {
      kind?: 'NEW' | 'EDIT';
      productId?: string | null;
      payload?: Record<string, unknown>;
      price?: number;
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
      name?: string;
    } = {}
  ): Promise<string> {
    seq += 1;
    const kind = opts.kind ?? 'NEW';
    const payload =
      opts.payload ??
      (kind === 'NEW'
        ? { name: opts.name ?? `SF Item ${tag} ${stamp} ${seq}`, category_id: categoryId, unit: '1 kg', pack_size: '500 g', description: 'Home made', barcode: null }
        : {});
    return (
      await pool.query(
        `INSERT INTO seller_submissions (seller_id, product_id, kind, status, payload, seller_price)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
        [sellerId, opts.productId ?? null, kind, opts.status ?? 'PENDING', JSON.stringify(payload), opts.price ?? 80]
      )
    ).rows[0].id as string;
  }

  const row = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];
  const audits = async (action: string, entityId: string) =>
    (await pool.query('SELECT * FROM audit_logs WHERE action = $1 AND entity_id = $2 ORDER BY created_at', [action, entityId])).rows;
  const texts = async (userId: string, type?: string) =>
    (
      await pool.query(
        `SELECT notification_type, recipient, payload FROM notifications WHERE user_id = $1 ${type ? 'AND notification_type = $2' : ''} ORDER BY created_at`,
        type ? [userId, type] : [userId]
      )
    ).rows as { notification_type: string; recipient: string; payload: { text: string } }[];

  async function cleanup() {
    const ids = sellers.map((s) => s.id);
    const userIds = sellers.map((s) => s.userId);
    if (ids.length) {
      const products = (await pool.query('SELECT id FROM products WHERE seller_id = ANY($1::uuid[])', [ids])).rows.map((r) => r.id);
      if (products.length) {
        await pool.query('DELETE FROM inventory_adjustments WHERE inventory_id IN (SELECT id FROM inventory WHERE product_id = ANY($1::uuid[]))', [products]);
        await pool.query('DELETE FROM inventory WHERE product_id = ANY($1::uuid[])', [products]);
        await pool.query('DELETE FROM seller_submissions WHERE product_id = ANY($1::uuid[])', [products]);
        await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [products]);
      }
      await pool.query('DELETE FROM seller_submissions WHERE seller_id = ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM seller_payouts WHERE seller_id = ANY($1::uuid[])', [ids]);
      await pool.query(
        `DELETE FROM audit_logs WHERE created_at >= $1 AND action LIKE 'SELLER\\_%' AND (entity_id = ANY($2::uuid[]) OR new_values->>'seller_id' = ANY($3::text[]))`,
        [testStart, ids, ids]
      );
      await pool.query('DELETE FROM sellers WHERE id = ANY($1::uuid[])', [ids]);
    }
    if (userIds.length) {
      await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[categoryId, otherCategoryId].filter(Boolean)]);
  }

  return {
    stamp,
    setup,
    seller,
    submission,
    cleanup,
    row,
    audits,
    texts,
    get categoryId() {
      return categoryId;
    },
    get otherCategoryId() {
      return otherCategoryId;
    },
    get testStart() {
      return testStart;
    },
  };
}
