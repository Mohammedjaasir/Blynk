import { sql, type Kysely, type Selectable } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, RepeatBasketLine, RepeatBasketsTable, RepeatBasketStatus } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { orderingClock } from '../../utils/time.js';
import { publicPhone } from '../../utils/phone.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import { estimateBasket } from './repeat.lines.js';
import { dayKeyOfWeekday, firstRunAt, placeAtInsideHours, type ScheduleSpec } from './repeat.schedule.js';
import {
  REPEAT_LIMITS,
  type CreateBasketInput,
  type FromOrderInput,
  type PatchBasketInput,
} from './repeat.schema.js';

/**
 * Repeat baskets (migration 054; contract docs/superpowers/plans/
 * 2026-10-24-buy-again-repeat.md section 2): the customer's saved baskets and
 * the staff view of them. The worker that places them is repeat.runner.ts.
 */

export type BasketRow = Omit<Selectable<RepeatBasketsTable>, 'start_date'> & { start_date: string | null };

/** Every column, with start_date as 'YYYY-MM-DD' text (a DATE would come back as a local-midnight Date). */
export function basketQuery(executor: Kysely<Database> = db) {
  return executor
    .selectFrom('repeat_baskets')
    .select([
      'repeat_baskets.id',
      'repeat_baskets.user_id',
      'repeat_baskets.name',
      'repeat_baskets.items',
      'repeat_baskets.frequency',
      'repeat_baskets.weekday',
      'repeat_baskets.place_at',
      sql<string | null>`to_char(repeat_baskets.start_date, 'YYYY-MM-DD')`.as('start_date'),
      'repeat_baskets.address_id',
      'repeat_baskets.notes',
      'repeat_baskets.status',
      'repeat_baskets.skip_next',
      'repeat_baskets.next_run_at',
      'repeat_baskets.last_run_at',
      'repeat_baskets.last_order_id',
      'repeat_baskets.created_at',
      'repeat_baskets.updated_at',
    ]);
}

export const specOf = (b: Pick<BasketRow, 'frequency' | 'weekday' | 'place_at' | 'start_date'>): ScheduleSpec => ({
  frequency: b.frequency,
  weekday: b.frequency === 'DAILY' ? null : b.weekday,
  place_at: b.place_at,
  start_date: b.start_date,
});

const validationError = (path: (string | number)[], message: string) =>
  new AppError(message, 400, 'VALIDATION_ERROR', [{ path, message }]);
export const basketNotFound = () => new AppError('Repeat basket not found.', 404, 'BASKET_NOT_FOUND');

async function lastRuns(basketIds: string[]) {
  const map = new Map<string, { run_at: Date; status: string; order_id: string | null; reason: string | null }>();
  if (basketIds.length === 0) return map;
  const rows = await db
    .selectFrom('repeat_basket_runs')
    .select(['basket_id', 'run_at', 'status', 'order_id', 'reason'])
    .distinctOn('basket_id')
    .where('basket_id', 'in', basketIds)
    .orderBy('basket_id')
    .orderBy('run_at', 'desc')
    .orderBy('created_at', 'desc')
    .execute();
  for (const r of rows) map.set(r.basket_id, { run_at: r.run_at, status: r.status, order_id: r.order_id, reason: r.reason });
  return map;
}

/** The customer's view of a basket: its fields, the last run and today's estimate. */
async function toCustomerDtos(rows: BasketRow[]) {
  const runs = await lastRuns(rows.map((r) => r.id));
  const now = orderingClock.now();
  return Promise.all(
    rows.map(async (b) => ({
      id: b.id,
      name: b.name,
      items: b.items,
      frequency: b.frequency,
      weekday: b.weekday,
      place_at: b.place_at,
      start_date: b.start_date,
      address_id: b.address_id,
      notes: b.notes,
      status: b.status,
      skip_next: b.skip_next,
      next_run_at: b.next_run_at,
      last_run_at: b.last_run_at,
      last_order_id: b.last_order_id,
      last_run: runs.get(b.id) ?? null,
      estimate: await estimateBasket(b.items, now),
      created_at: b.created_at,
      updated_at: b.updated_at,
    }))
  );
}

async function toCustomerDto(row: BasketRow) {
  return (await toCustomerDtos([row]))[0];
}

/** Products exist (not deleted); a size belongs to its product; a product with sizes names one. */
async function assertItems(items: readonly RepeatBasketLine[]): Promise<void> {
  const productIds = [...new Set(items.map((l) => l.product_id))];
  const products = await db
    .selectFrom('products')
    .select(['id', 'name', 'deleted_at'])
    .where('id', 'in', productIds)
    .execute();
  const productMap = new Map(products.map((p) => [p.id, p]));
  const variantIds = items.map((l) => l.variant_id).filter((v): v is string => !!v);
  const variants = variantIds.length
    ? await db.selectFrom('product_variants').select(['id', 'product_id', 'deleted_at']).where('id', 'in', variantIds).execute()
    : [];
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const withSizes = new Set(
    (
      await db
        .selectFrom('v_product_catalog')
        .select(['id', 'has_variants'])
        .where('id', 'in', productIds)
        .execute()
    )
      .filter((r) => r.has_variants === true)
      .map((r) => r.id)
  );
  items.forEach((l, i) => {
    const p = productMap.get(l.product_id);
    if (!p || p.deleted_at) throw validationError(['items', i, 'product_id'], 'That product is no longer sold');
    if (l.variant_id) {
      const v = variantMap.get(l.variant_id);
      if (!v || v.deleted_at || v.product_id !== l.product_id) {
        throw validationError(['items', i, 'variant_id'], `That size of '${p.name}' is no longer sold`);
      }
    } else if (withSizes.has(l.product_id)) {
      throw validationError(['items', i, 'variant_id'], `Choose a size of '${p.name}'`);
    }
  });
}

async function assertAddress(userId: string, addressId: string): Promise<void> {
  const row = await db
    .selectFrom('customer_addresses')
    .select('id')
    .where('id', '=', addressId)
    .where('user_id', '=', userId)
    .where('is_deleted', '=', false)
    .executeTakeFirst();
  if (!row) throw validationError(['address_id'], 'Delivery address not found');
}

/** 400 PLACE_AT_OUTSIDE_HOURS unless place_at is inside the opening hours on the days it runs. */
async function assertPlaceAt(spec: Pick<ScheduleSpec, 'frequency' | 'weekday' | 'place_at'>): Promise<void> {
  const schedule = await storeSchedule.read();
  if (placeAtInsideHours(spec, schedule.hours)) return;
  const days =
    spec.frequency === 'DAILY'
      ? schedule.hours.days
      : { [dayKeyOfWeekday(spec.weekday ?? 0)]: schedule.hours.days[dayKeyOfWeekday(spec.weekday ?? 0)] };
  throw new AppError('Pick a time inside the store opening hours.', 400, 'PLACE_AT_OUTSIDE_HOURS', {
    place_at: spec.place_at,
    hours: days,
  });
}

function normaliseSpec(input: { frequency: ScheduleSpec['frequency']; weekday?: number | null; place_at: string; start_date?: string | null }): ScheduleSpec {
  return {
    frequency: input.frequency,
    weekday: input.frequency === 'DAILY' ? null : (input.weekday ?? null),
    place_at: input.place_at,
    start_date: input.start_date ?? null,
  };
}

/** Inserts a basket under the customer's row lock, so racing requests cannot pass the limit of 5. */
async function insertBasket(
  userId: string,
  data: { name?: string; items: RepeatBasketLine[]; spec: ScheduleSpec; address_id: string; notes?: string | null }
): Promise<BasketRow> {
  const nextRunAt = firstRunAt(data.spec, orderingClock.now());
  const id = await db.transaction().execute(async (trx) => {
    await trx.selectFrom('users').select('id').where('id', '=', userId).forNoKeyUpdate().executeTakeFirst();
    const count = await trx
      .selectFrom('repeat_baskets')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('user_id', '=', userId)
      .where('status', '!=', 'CANCELLED')
      .executeTakeFirst();
    if ((count?.n ?? 0) >= REPEAT_LIMITS.baskets) {
      throw new AppError(`You can have at most ${REPEAT_LIMITS.baskets} repeat baskets.`, 409, 'BASKET_LIMIT', {
        limit: REPEAT_LIMITS.baskets,
      });
    }
    const row = await trx
      .insertInto('repeat_baskets')
      .values({
        user_id: userId,
        ...(data.name ? { name: data.name } : {}),
        items: JSON.stringify(data.items),
        frequency: data.spec.frequency,
        weekday: data.spec.weekday,
        place_at: data.spec.place_at,
        start_date: data.spec.start_date,
        address_id: data.address_id,
        notes: data.notes ?? null,
        status: 'ACTIVE',
        next_run_at: nextRunAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  return (await basketQuery().where('id', '=', id).executeTakeFirstOrThrow()) as BasketRow;
}

async function ownBasket(userId: string, id: string): Promise<BasketRow> {
  const row = await basketQuery()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('status', '!=', 'CANCELLED')
    .executeTakeFirst();
  if (!row) throw basketNotFound();
  return row as BasketRow;
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

export async function listCustomerBaskets(userId: string) {
  const rows = (await basketQuery()
    .where('user_id', '=', userId)
    .where('status', '!=', 'CANCELLED')
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()) as BasketRow[];
  return { baskets: await toCustomerDtos(rows) };
}

export async function createCustomerBasket(userId: string, input: CreateBasketInput) {
  const spec = normaliseSpec(input);
  await assertItems(input.items);
  await assertAddress(userId, input.address_id);
  await assertPlaceAt(spec);
  const row = await insertBasket(userId, { name: input.name, items: input.items, spec, address_id: input.address_id, notes: input.notes });
  return { basket: await toCustomerDto(row) };
}

/**
 * "Repeat this basket" on an order: its loose lines that reached the customer
 * (not removed as unavailable or substituted; combo packs left out), products
 * still sold, quantities capped at 20, at most 30 lines. The address defaults
 * to the saved address the order went to (matched by its first line and
 * position), else the customer's default address.
 */
export async function createBasketFromOrder(userId: string, orderId: string, input: FromOrderInput) {
  const order = await db
    .selectFrom('orders')
    .select(['id', 'delivery_address_line1', 'delivery_latitude', 'delivery_longitude', 'customer_notes'])
    .where('id', '=', orderId)
    .where('customer_id', '=', userId)
    .executeTakeFirst();
  if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

  const rows = await db
    .selectFrom('order_items as oi')
    .innerJoin('products as p', 'p.id', 'oi.product_id')
    .leftJoin('product_variants as pv', 'pv.id', 'oi.variant_id')
    .select(['oi.product_id', 'oi.variant_id', 'oi.quantity'])
    .where('oi.order_id', '=', order.id)
    .where('oi.order_combo_id', 'is', null)
    .where('oi.item_status', 'not in', ['UNAVAILABLE', 'SUBSTITUTED'])
    .where('p.deleted_at', 'is', null)
    .where((eb) => eb.or([eb('oi.variant_id', 'is', null), eb('pv.deleted_at', 'is', null)]))
    .orderBy('oi.created_at', 'asc')
    .orderBy('oi.id', 'asc')
    .execute();
  const merged = new Map<string, RepeatBasketLine>();
  for (const r of rows) {
    const key = `${r.product_id}:${r.variant_id ?? ''}`;
    const prev = merged.get(key);
    merged.set(key, {
      product_id: r.product_id,
      variant_id: r.variant_id ?? null,
      quantity: Math.min(REPEAT_LIMITS.quantity, (prev?.quantity ?? 0) + r.quantity),
    });
  }
  // A product that has sizes now but was ordered without one cannot be repeated as it was.
  const lines = [...merged.values()];
  const withSizes = new Set(
    lines.length
      ? (
          await db
            .selectFrom('v_product_catalog')
            .select(['id', 'has_variants'])
            .where('id', 'in', lines.map((l) => l.product_id))
            .execute()
        )
          .filter((r) => r.has_variants === true)
          .map((r) => r.id)
      : []
  );
  const items = lines.filter((l) => l.variant_id || !withSizes.has(l.product_id)).slice(0, REPEAT_LIMITS.lines);
  if (items.length === 0) throw validationError(['items'], 'Nothing in this order can be repeated');

  let addressId = input.address_id ?? null;
  if (addressId) {
    await assertAddress(userId, addressId);
  } else {
    const match = await db
      .selectFrom('customer_addresses')
      .select('id')
      .where('user_id', '=', userId)
      .where('is_deleted', '=', false)
      .orderBy(
        sql`(address_line1 = ${order.delivery_address_line1}
             AND abs(latitude - ${order.delivery_latitude}) < 0.0001
             AND abs(longitude - ${order.delivery_longitude}) < 0.0001)`,
        'desc'
      )
      .orderBy('is_default', 'desc')
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!match) throw validationError(['address_id'], 'Add a delivery address first');
    addressId = match.id;
  }

  const spec = normaliseSpec(input);
  await assertPlaceAt(spec);
  const row = await insertBasket(userId, { name: input.name, items, spec, address_id: addressId, notes: input.notes });
  return { basket: await toCustomerDto(row) };
}

export async function patchCustomerBasket(userId: string, id: string, input: PatchBasketInput) {
  const current = await ownBasket(userId, id);
  const frequency = input.frequency ?? current.frequency;
  const weekday = frequency === 'DAILY' ? null : input.weekday !== undefined ? input.weekday : current.weekday;
  if (frequency !== 'DAILY' && (weekday === null || weekday === undefined)) {
    throw validationError(['weekday'], 'Pick the day of the week');
  }
  const spec: ScheduleSpec = {
    frequency,
    weekday,
    place_at: input.place_at ?? current.place_at,
    start_date: input.start_date !== undefined ? input.start_date : current.start_date,
  };
  const scheduleChanged =
    input.frequency !== undefined || input.weekday !== undefined || input.place_at !== undefined || input.start_date !== undefined;
  if (input.items) await assertItems(input.items);
  if (input.address_id) await assertAddress(userId, input.address_id);
  if (scheduleChanged) await assertPlaceAt(spec);

  const status: RepeatBasketStatus = input.status ?? current.status;
  const statusChanged = status !== current.status;
  let nextRunAt = current.next_run_at;
  if (status === 'PAUSED') nextRunAt = null;
  else if (scheduleChanged || statusChanged || !nextRunAt) nextRunAt = firstRunAt(spec, orderingClock.now());

  await db
    .updateTable('repeat_baskets')
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.items ? { items: JSON.stringify(input.items) } : {}),
      ...(input.address_id ? { address_id: input.address_id } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      frequency: spec.frequency,
      weekday: spec.weekday,
      place_at: spec.place_at,
      start_date: spec.start_date,
      status,
      next_run_at: nextRunAt,
      updated_at: new Date(),
    })
    .where('id', '=', current.id)
    .where('status', '!=', 'CANCELLED')
    .execute();
  return { basket: await toCustomerDto(await ownBasket(userId, id)) };
}

/** Toggles "skip the next delivery"; the worker records that run as SKIPPED and clears it. */
export async function toggleSkipNext(userId: string, id: string) {
  const current = await ownBasket(userId, id);
  await db
    .updateTable('repeat_baskets')
    .set({ skip_next: !current.skip_next, updated_at: new Date() })
    .where('id', '=', current.id)
    .execute();
  return { basket: await toCustomerDto(await ownBasket(userId, id)) };
}

export async function cancelCustomerBasket(userId: string, id: string) {
  const current = await ownBasket(userId, id);
  await db
    .updateTable('repeat_baskets')
    .set({ status: 'CANCELLED', next_run_at: null, skip_next: false, updated_at: new Date() })
    .where('id', '=', current.id)
    .execute();
  const row = (await basketQuery().where('id', '=', current.id).executeTakeFirstOrThrow()) as BasketRow;
  return { basket: await toCustomerDto(row) };
}

// ---------------------------------------------------------------------------
// Staff (ADMIN, OPERATIONS)
// ---------------------------------------------------------------------------

async function staffRows(where: { status?: RepeatBasketStatus; id?: string }, limit: number, offset: number) {
  let q = db
    .selectFrom('repeat_baskets as b')
    .innerJoin('users as u', 'u.id', 'b.user_id')
    .select([
      'b.id',
      'b.name',
      'b.status',
      'b.frequency',
      'b.weekday',
      'b.place_at',
      sql<string | null>`to_char(b.start_date, 'YYYY-MM-DD')`.as('start_date'),
      'b.skip_next',
      'b.next_run_at',
      'b.last_run_at',
      'b.last_order_id',
      'b.address_id',
      'b.notes',
      'b.created_at',
      'b.updated_at',
      sql<number>`jsonb_array_length(b.items)::int`.as('items_count'),
      'b.items',
      'u.id as customer_id',
      'u.full_name as customer_name',
      'u.phone as customer_phone',
    ]);
  if (where.status) q = q.where('b.status', '=', where.status);
  if (where.id) q = q.where('b.id', '=', where.id);
  const rows = await q.orderBy('b.next_run_at', 'asc').orderBy('b.created_at', 'desc').orderBy('b.id', 'asc').limit(limit).offset(offset).execute();
  const runs = await lastRuns(rows.map((r) => r.id));
  return rows.map(({ customer_id, customer_name, customer_phone, ...b }) => ({
    ...b,
    customer: { id: customer_id, full_name: customer_name, phone: publicPhone(customer_phone) },
    last_run: runs.get(b.id) ?? null,
  }));
}

export async function listStaffBaskets(query: { status?: RepeatBasketStatus; page: number; limit: number }) {
  let countQ = db.selectFrom('repeat_baskets').select(sql<number>`count(*)::int`.as('n'));
  if (query.status) countQ = countQ.where('status', '=', query.status);
  const [baskets, count] = await Promise.all([
    staffRows({ status: query.status }, query.limit, (query.page - 1) * query.limit),
    countQ.executeTakeFirst(),
  ]);
  const total = count?.n ?? 0;
  return {
    baskets,
    pagination: { page: query.page, limit: query.limit, total, total_pages: Math.ceil(total / query.limit) || 1 },
  };
}

/** Pause, resume or cancel a customer's basket (audited REPEAT_BASKET_UPDATED). A cancelled basket stays cancelled. */
export async function patchStaffBasket(id: string, status: RepeatBasketStatus, actor: AuditActor) {
  await db.transaction().execute(async (trx) => {
    const current = (await basketQuery(trx).where('id', '=', id).forUpdate().executeTakeFirst()) as BasketRow | undefined;
    if (!current) throw basketNotFound();
    if (current.status === 'CANCELLED' && status !== 'CANCELLED') {
      throw new AppError('A cancelled repeat basket cannot be changed.', 409, 'BASKET_CANCELLED');
    }
    if (current.status === status) return;
    const nextRunAt = status === 'ACTIVE' ? firstRunAt(specOf(current), orderingClock.now()) : null;
    await trx
      .updateTable('repeat_baskets')
      .set({ status, next_run_at: nextRunAt, ...(status === 'CANCELLED' ? { skip_next: false } : {}), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'REPEAT_BASKET_UPDATED',
      entityType: 'repeat_basket',
      entityId: id,
      oldValues: { status: current.status, next_run_at: current.next_run_at },
      newValues: { status, next_run_at: nextRunAt, user_id: current.user_id },
    });
  });
  const [basket] = await staffRows({ id }, 1, 0);
  return { basket };
}
