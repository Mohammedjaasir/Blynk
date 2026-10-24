import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { calculateHaversineKm } from '../src/utils/geo.js';
import {
  activeStoreLocation,
  sellerPickupPoints,
  setSellerLocationColumnsForTests,
  type StoreLocation,
} from '../src/modules/sellers/seller.location.js';
import { tokens, auth } from './helpers/stock.js';
import { sellerFixtures } from './helpers/seller-fixtures.js';

/**
 * Seller shop location (migration 053): the seller pins the shop (PUT /seller/profile), the pin
 * waits for Admin (POST /admin/sellers/:id/location/approve | reject), only the approved point is
 * used for delivery (sellerPickupPoints) - and everything keeps working, without 500s, while the
 * migration has not run yet (the guard's test hook pretends the columns are missing).
 */
const app = createApp();
const fx = sellerFixtures('loc');
const A = '/api/v1/admin';

const me = (token: string) => request(app).get('/api/v1/seller/me').set(auth(token));
const putProfile = (token: string, body: object) => request(app).put('/api/v1/seller/profile').set(auth(token)).send(body);
const approveLoc = (id: string, token = tokens.admin) => request(app).post(`${A}/sellers/${id}/location/approve`).set(auth(token)).send({});
const rejectLoc = (id: string, body: unknown, token = tokens.admin) =>
  request(app).post(`${A}/sellers/${id}/location/reject`).set(auth(token)).send(body as object);
const adminSeller = async (id: string) => (await request(app).get(`${A}/sellers/${id}`).set(auth(tokens.admin))).body.data.seller;

// Kandy and Galle: both inside Sri Lanka
const KANDY = { latitude: 7.290572, longitude: 80.633728 };
const GALLE = { latitude: 6.032894, longitude: 80.216791 };

let store: StoreLocation | null = null;
const kmFromStore = (p: { latitude: number; longitude: number }) =>
  store ? Math.round(calculateHaversineKm(store.lat, store.lng, p.latitude, p.longitude) * 10) / 10 : null;

const LOCATION_KEYS = [
  'latitude',
  'longitude',
  'location_note',
  'pending_latitude',
  'pending_longitude',
  'pending_location_note',
  'location_status',
  'location_reject_reason',
  'distance_km_from_store',
  'pending_distance_km_from_store',
];

async function sellerProduct(sellerId: string, tag: string) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return (
    await pool.query(
      `INSERT INTO products (category_id, name, slug, sku, unit, purchase_cost, pricing_mode, fixed_selling_price, is_active, is_available, seller_id)
       VALUES ($1, $2, $3, $4, '1 kg', 100, 'FIXED', 150, true, true, $5) RETURNING id`,
      [fx.categoryId, `Loc ${tag} ${stamp}`, `loc-${tag}-${stamp}`, `LOC-${tag}-${stamp}`, sellerId]
    )
  ).rows[0].id as string;
}

beforeAll(async () => {
  await fx.setup();
  store = await activeStoreLocation();
});
afterAll(fx.cleanup);
afterEach(() => setSellerLocationColumnsForTests(null));

describe('PUT /seller/profile: the shop pin waits for Admin', () => {
  it('a new pin is PENDING; the approved point stays empty; GET /me shows the same', async () => {
    expect(store).not.toBeNull(); // the local DB has an active dark store, so distances are real numbers here
    const s = await fx.seller({ status: 'PENDING' });
    const res = await putProfile(s.token, { shop_name: s.shop, ...KANDY, location_note: 'Behind the temple road bakery' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({
      latitude: null,
      longitude: null,
      location_note: null,
      pending_latitude: KANDY.latitude,
      pending_longitude: KANDY.longitude,
      pending_location_note: 'Behind the temple road bakery',
      location_status: 'PENDING',
      location_reject_reason: null,
      distance_km_from_store: null,
      pending_distance_km_from_store: kmFromStore(KANDY),
    });
    const got = await me(s.token);
    expect(got.status).toBe(200);
    expect(got.body.data.seller).toEqual(res.body.data.seller);
    // the rest of the Seller shape is unchanged
    expect(Object.keys(got.body.data.seller).sort()).toEqual(
      ['id', 'shop_name', 'contact_name', 'address', 'note', 'status', 'rejection_reason', 'commission_percent', 'created_at', ...LOCATION_KEYS].sort()
    );
  });

  it('a seller who never pinned reads NONE with every location field null', async () => {
    const s = await fx.seller();
    const got = await me(s.token);
    expect(got.body.data.seller).toMatchObject({
      latitude: null,
      longitude: null,
      location_note: null,
      pending_latitude: null,
      pending_longitude: null,
      pending_location_note: null,
      location_status: 'NONE',
      location_reject_reason: null,
      distance_km_from_store: null,
      pending_distance_km_from_store: null,
    });
  });

  it('validates: Sri Lanka bounds, both-or-neither, numbers, note length', async () => {
    const s = await fx.seller();
    const cases: [object, string][] = [
      [{ latitude: 10.0, longitude: 80.5 }, 'latitude'],
      [{ latitude: 5.7, longitude: 80.5 }, 'latitude'],
      [{ latitude: 7.0, longitude: 79.4 }, 'longitude'],
      [{ latitude: 7.0, longitude: 82.0 }, 'longitude'],
      [{ latitude: 51.5, longitude: -0.12 }, 'latitude'],
      [{ latitude: 7.0 }, 'longitude'],
      [{ longitude: 80.5 }, 'latitude'],
      [{ latitude: null, longitude: 80.5 }, 'latitude'],
      [{ latitude: 7.0, longitude: null }, 'longitude'],
      [{ latitude: '7.0', longitude: 80.5 }, 'latitude'],
      [{ location_note: 'x'.repeat(201) }, 'location_note'],
    ];
    for (const [body, field] of cases) {
      const res = await putProfile(s.token, { shop_name: s.shop, ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((res.body.error.details as { field: string }[]).map((d) => d.field), JSON.stringify(body)).toContain(field);
    }
    expect((await fx.row('SELECT location_status, pending_latitude FROM sellers WHERE id = $1', [s.id]))).toEqual({
      location_status: 'NONE',
      pending_latitude: null,
    });
    // the edges are inside
    const edge = await putProfile(s.token, { shop_name: s.shop, latitude: 9.9, longitude: 81.95, location_note: 'x'.repeat(200) });
    expect(edge.status).toBe(200);
  });

  it('null + null withdraws the waiting change; a note alone is kept for later', async () => {
    const s = await fx.seller();
    await putProfile(s.token, { shop_name: s.shop, ...KANDY });
    const cleared = await putProfile(s.token, { shop_name: s.shop, latitude: null, longitude: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.seller).toMatchObject({ location_status: 'NONE', pending_latitude: null, pending_longitude: null, pending_location_note: null });

    const noted = await putProfile(s.token, { shop_name: s.shop, location_note: 'Blue gate' });
    expect(noted.body.data.seller).toMatchObject({ location_status: 'NONE', pending_location_note: 'Blue gate', pending_latitude: null });
    // pinning later keeps that note
    const pinned = await putProfile(s.token, { shop_name: s.shop, ...GALLE });
    expect(pinned.body.data.seller).toMatchObject({ location_status: 'PENDING', pending_latitude: GALLE.latitude, pending_location_note: 'Blue gate' });
    // a profile save without location fields leaves it alone
    const plain = await putProfile(s.token, { shop_name: 'Renamed Shop' });
    expect(plain.body.data.seller).toMatchObject({ shop_name: 'Renamed Shop', location_status: 'PENDING', pending_latitude: GALLE.latitude });
  });

  it('is refused for a suspended seller', async () => {
    const s = await fx.seller({ status: 'SUSPENDED' });
    const res = await putProfile(s.token, { shop_name: s.shop, ...KANDY });
    expect(res.status).toBe(403);
    expect((await fx.row('SELECT location_status FROM sellers WHERE id = $1', [s.id])).location_status).toBe('NONE');
  });
});

describe('Admin approves or rejects the pin', () => {
  it('approve copies the waiting point to the one in use, audited; then 409 with nothing waiting', async () => {
    const s = await fx.seller();
    await putProfile(s.token, { shop_name: s.shop, ...KANDY, location_note: 'Near the clock tower' });

    const before = await adminSeller(s.id);
    expect(before).toMatchObject({ location_status: 'PENDING', pending_latitude: KANDY.latitude, latitude: null, distance_km_from_store: null });

    const res = await approveLoc(s.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({
      id: s.id,
      latitude: KANDY.latitude,
      longitude: KANDY.longitude,
      location_note: 'Near the clock tower',
      pending_latitude: null,
      pending_longitude: null,
      pending_location_note: null,
      location_status: 'APPROVED',
      distance_km_from_store: kmFromStore(KANDY),
      pending_distance_km_from_store: null,
      // the usual AdminSeller fields are still there
      shop_name: s.shop,
      products_live: 0,
      due: 0,
    });
    const row = await fx.row('SELECT location_reviewed_by, location_reviewed_at FROM sellers WHERE id = $1', [s.id]);
    expect(row.location_reviewed_by).toBe('a0000001-0000-0000-0000-000000000003');
    expect(row.location_reviewed_at).not.toBeNull();
    const audit = await fx.audits('SELLER_LOCATION_APPROVED', s.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ latitude: KANDY.latitude, longitude: KANDY.longitude, location_note: 'Near the clock tower' });

    const again = await approveLoc(s.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LOCATION_NOT_PENDING');

    // the seller sees it as approved too
    expect((await me(s.token)).body.data.seller).toMatchObject({ location_status: 'APPROVED', latitude: KANDY.latitude, distance_km_from_store: kmFromStore(KANDY) });
  });

  it('a moved pin waits while the approved one stays; reject keeps the approved one and tells the seller why', async () => {
    const s = await fx.seller();
    await putProfile(s.token, { shop_name: s.shop, ...KANDY });
    expect((await approveLoc(s.id)).status).toBe(200);

    const moved = await putProfile(s.token, { shop_name: s.shop, ...GALLE });
    expect(moved.body.data.seller).toMatchObject({
      latitude: KANDY.latitude,
      longitude: KANDY.longitude,
      pending_latitude: GALLE.latitude,
      pending_longitude: GALLE.longitude,
      location_status: 'PENDING',
      distance_km_from_store: kmFromStore(KANDY),
      pending_distance_km_from_store: kmFromStore(GALLE),
    });

    for (const body of [{}, { reason: 'no' }, { reason: 'x'.repeat(201) }, { reason: 'Wrong town', extra: 1 }]) {
      const bad = await rejectLoc(s.id, body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    }

    const res = await rejectLoc(s.id, { reason: '  The pin is in the sea  ' });
    expect(res.status).toBe(200);
    expect(res.body.data.seller).toMatchObject({
      location_status: 'REJECTED',
      location_reject_reason: 'The pin is in the sea',
      latitude: KANDY.latitude,
      pending_latitude: GALLE.latitude,
    });
    expect(await fx.audits('SELLER_LOCATION_REJECTED', s.id)).toHaveLength(1);
    expect((await me(s.token)).body.data.seller).toMatchObject({ location_status: 'REJECTED', location_reject_reason: 'The pin is in the sea' });

    // nothing is waiting any more
    expect((await rejectLoc(s.id, { reason: 'Again please' })).status).toBe(409);
    // the seller tries again: waiting, and the old reason is gone
    const retry = await putProfile(s.token, { shop_name: s.shop, latitude: 7.3, longitude: 80.64 });
    expect(retry.body.data.seller).toMatchObject({ location_status: 'PENDING', location_reject_reason: null, latitude: KANDY.latitude });
  });

  it('sending the approved point back cancels the waiting change; a changed note waits for Admin', async () => {
    const s = await fx.seller();
    await putProfile(s.token, { shop_name: s.shop, ...KANDY, location_note: 'Red door' });
    await approveLoc(s.id);
    await putProfile(s.token, { shop_name: s.shop, ...GALLE });
    const back = await putProfile(s.token, { shop_name: s.shop, ...KANDY });
    expect(back.body.data.seller).toMatchObject({ location_status: 'APPROVED', pending_latitude: null, location_note: 'Red door' });

    const note = await putProfile(s.token, { shop_name: s.shop, location_note: 'Green door' });
    expect(note.body.data.seller).toMatchObject({
      location_status: 'PENDING',
      pending_latitude: KANDY.latitude,
      pending_longitude: KANDY.longitude,
      pending_location_note: 'Green door',
      location_note: 'Red door',
    });
  });

  it('the list carries the location fields; 404 / 400 / 403 for the review routes', async () => {
    const s = await fx.seller({ shop: `Loc Listed ${fx.stamp}` });
    await putProfile(s.token, { shop_name: s.shop, ...KANDY });
    const list = await request(app).get(`${A}/sellers?search=${encodeURIComponent(`Loc Listed ${fx.stamp}`)}`).set(auth(tokens.admin));
    expect(list.status).toBe(200);
    expect(list.body.data.sellers).toHaveLength(1);
    expect(list.body.data.sellers[0]).toMatchObject({ id: s.id, location_status: 'PENDING', pending_latitude: KANDY.latitude, latitude: null });
    for (const k of LOCATION_KEYS) expect(list.body.data.sellers[0]).toHaveProperty(k);

    expect((await approveLoc('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await approveLoc('not-an-id')).status).toBe(400);
    for (const token of [s.token, tokens.customer, tokens.rider]) {
      expect((await approveLoc(s.id, token)).status).toBe(403);
      expect((await rejectLoc(s.id, { reason: 'Not allowed' }, token)).status).toBe(403);
    }
    expect((await fx.row('SELECT location_status FROM sellers WHERE id = $1', [s.id])).location_status).toBe('PENDING');
  });
});

describe('sellerPickupPoints (for the delivery charge)', () => {
  it('only products of sellers with an approved point; Blynk products and waiting pins are absent', async () => {
    const approved = await fx.seller({ shop: `Loc Pickup ${fx.stamp}` });
    await putProfile(approved.token, { shop_name: approved.shop, ...KANDY });
    await approveLoc(approved.id);
    const waiting = await fx.seller();
    await putProfile(waiting.token, { shop_name: waiting.shop, ...GALLE });
    const none = await fx.seller();

    const pA = await sellerProduct(approved.id, 'a');
    const pW = await sellerProduct(waiting.id, 'w');
    const pN = await sellerProduct(none.id, 'n');
    const blynk = (await fx.row('SELECT id FROM products WHERE seller_id IS NULL AND deleted_at IS NULL LIMIT 1'))?.id as string | undefined;

    const points = await sellerPickupPoints([pA, pW, pN, ...(blynk ? [blynk] : []), 'not-a-uuid', pA]);
    expect([...points.keys()]).toEqual([pA]);
    expect(points.get(pA)).toEqual({ seller_id: approved.id, shop_name: approved.shop, lat: KANDY.latitude, lng: KANDY.longitude });

    // a moved (waiting) pin does not move the pickup
    await putProfile(approved.token, { shop_name: approved.shop, ...GALLE });
    expect((await sellerPickupPoints([pA])).get(pA)).toMatchObject({ lat: KANDY.latitude, lng: KANDY.longitude });

    expect((await sellerPickupPoints([])).size).toBe(0);
  });
});

describe('Before migration 053 has run (guarded)', () => {
  it('reads as no location, saves the rest of the profile, refuses a pin with 503, and never 500s', async () => {
    const s = await fx.seller();
    await putProfile(s.token, { shop_name: s.shop, ...KANDY });
    await approveLoc(s.id);
    const product = await sellerProduct(s.id, 'g');
    await putProfile(s.token, { shop_name: s.shop, ...GALLE });

    setSellerLocationColumnsForTests(false);

    const got = await me(s.token);
    expect(got.status).toBe(200);
    expect(got.body.data.seller).toMatchObject({
      latitude: null,
      longitude: null,
      location_note: null,
      pending_latitude: null,
      pending_longitude: null,
      pending_location_note: null,
      location_status: 'NONE',
      location_reject_reason: null,
      distance_km_from_store: null,
      pending_distance_km_from_store: null,
    });

    for (const body of [{ ...KANDY }, { location_note: 'Blue gate' }]) {
      const refused = await putProfile(s.token, { shop_name: 'Should Not Save', ...body });
      expect(refused.status, JSON.stringify(body)).toBe(503);
      expect(refused.body.error.code).toBe('LOCATION_NOT_READY');
      expect(refused.body.error.message).toBe('Shop location will be available shortly.');
    }
    expect((await fx.row('SELECT shop_name FROM sellers WHERE id = $1', [s.id])).shop_name).toBe(s.shop);

    // nulls (nothing to keep) do not block the rest of the profile
    const saved = await putProfile(s.token, { shop_name: 'Saved Anyway', latitude: null, longitude: null, location_note: null });
    expect(saved.status).toBe(200);
    expect(saved.body.data.seller).toMatchObject({ shop_name: 'Saved Anyway', location_status: 'NONE', latitude: null });

    const list = await request(app).get(`${A}/sellers`).set(auth(tokens.admin));
    expect(list.status).toBe(200);
    const mine = (list.body.data.sellers as { id: string }[]).find((x) => x.id === s.id);
    expect(mine).toMatchObject({ latitude: null, pending_latitude: null, location_status: 'NONE', distance_km_from_store: null });
    expect((await request(app).get(`${A}/sellers/${s.id}`).set(auth(tokens.admin))).status).toBe(200);

    const approve = await approveLoc(s.id);
    expect(approve.status).toBe(503);
    expect(approve.body.error.code).toBe('LOCATION_NOT_READY');
    expect((await rejectLoc(s.id, { reason: 'Not yet please' })).status).toBe(503);

    expect((await sellerPickupPoints([product])).size).toBe(0);

    setSellerLocationColumnsForTests(null);
    // the waiting pin was untouched by all of that
    expect((await me(s.token)).body.data.seller).toMatchObject({ location_status: 'PENDING', latitude: KANDY.latitude, pending_latitude: GALLE.latitude });
  });
});
