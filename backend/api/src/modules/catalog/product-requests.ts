import { Router, type NextFunction, type Request, type Response } from 'express';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import type { Database, ProductRequestStatus } from '../../database/types.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { clientIp } from '../../utils/client-ip.js';
import { normalizeSriLankanPhone, publicPhone } from '../../utils/phone.js';
import { authRateLimiter } from '../auth/auth.rate-limiter.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { bestEffort, enqueuePush } from '../notifications/push/push.repository.js';
import { isPushEnabled } from '../notifications/push/push.sender.js';
import { hasProductRequestsTable, productRequestsNotReady } from './product-requests.ready.js';

/**
 * "Can't find it? Ask us" (migration 056; owner, 2026-10-24: "customers request products we don't
 * stock, Admin sees the most-requested list").
 *
 * Customer (signed in, or a guest):
 *   POST /product-requests            { name (2-80), note? (<=300), category_id? } -> 201 { request, already_requested }
 *                                     5 per customer per rolling day; guests 5 an hour / 20 a day per IP.
 *                                     The same customer asking again for an open (NEW / PLANNED) request of the
 *                                     same name gets that request back (201, already_requested: true), uncounted.
 *   GET  /me/product-requests         the customer's own requests, newest first, with status (and the product once ADDED)
 * Staff (ADMIN, OPERATIONS):
 *   GET   /admin/product-requests?status=&sort=popular|newest&limit=
 *         -> { groups: [{ key, name, count, requests_total, last_requested_at, status, category_id, category_name,
 *                         product_id, product_name, staff_note, requests: [...] }] }
 *         Requests group by name_key (lowercase, trimmed, spaces collapsed). `count` = distinct people (a guest
 *         request counts as one person); `status` = the newest request's status (a status change sets them all).
 *   PATCH /admin/product-requests/:key { status, product_id?, staff_note? } - the whole group. ADDED with a live
 *         product tells each requester once per product: a push when they have a device, else an SMS
 *         "Blynk: <name> is now available..." (outbox, best effort - it never fails the change).
 *
 * A new request joins its group's PLANNED / ADDED status (with the product); after DECLINED (or NEW) it starts
 * as NEW, so an item asked for again comes back to the top of the NEW list.
 *
 * Until migration 056 has run every route here answers 503 PRODUCT_REQUESTS_NOT_READY (product-requests.ready.ts).
 */

export const PRODUCT_REQUEST_STATUSES: readonly ProductRequestStatus[] = ['NEW', 'PLANNED', 'ADDED', 'DECLINED'];
export const PRODUCT_REQUEST_LIMITS = {
  perCustomerPerDay: 5,
  guestPerIpPerHour: 5,
  guestPerIpPerDay: 20,
  groupsMax: 500,
  groupsDefault: 100,
  requestsPerGroup: 50,
} as const;
export const PRODUCT_REQUEST_ADDED_SMS = 'PRODUCT_REQUEST_ADDED';
export const PRODUCT_REQUEST_ADDED_PUSH = 'PUSH_PRODUCT_REQUEST_ADDED';

/** The group key exactly as the generated name_key column computes it. */
const keyOf = (text: string) => sql<string>`lower(btrim(regexp_replace(${text}::text, '\\s+', ' ', 'g')))`;

const oneLine = /^[^\r\n\t]*$/;
const createSchema = z.object({
  name: z
    .string({ required_error: 'Write the product name', invalid_type_error: 'The name must be text' })
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(2, 'The name needs at least 2 characters')
        .max(80, 'The name can be at most 80 characters')
        .regex(oneLine, 'The name must be on one line')
    ),
  note: z
    .string({ invalid_type_error: 'The note must be text' })
    .trim()
    .max(300, 'The note can be at most 300 characters')
    .nullish()
    .transform((v) => v || null),
  category_id: z.string().uuid('Pick a category from the list').nullish().transform((v) => v ?? null),
});

const statusSchema = z.enum(PRODUCT_REQUEST_STATUSES as [ProductRequestStatus, ...ProductRequestStatus[]], {
  errorMap: () => ({ message: `The status must be one of ${PRODUCT_REQUEST_STATUSES.join(', ')}` }),
});

const listQuerySchema = z.object({
  status: z.preprocess((v) => (v === '' ? undefined : typeof v === 'string' ? v.toUpperCase() : v), statusSchema.optional()),
  sort: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['popular', 'newest']).default('popular')),
  limit: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).max(PRODUCT_REQUEST_LIMITS.groupsMax).default(PRODUCT_REQUEST_LIMITS.groupsDefault)
  ),
});

const patchSchema = z
  .object({
    status: statusSchema,
    product_id: z.string().uuid('product_id must be a product id').nullable().optional(),
    staff_note: z
      .string({ invalid_type_error: 'The note must be text' })
      .trim()
      .max(300, 'The note can be at most 300 characters')
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
  })
  .strict();

// ----------------------------------------------------------------------------
// Customer side
// ----------------------------------------------------------------------------

export interface CreateRequester {
  userId: string | null;
  ip: string | null;
}

export async function createProductRequest(requester: CreateRequester, raw: unknown) {
  const input = createSchema.parse(raw);
  if (input.category_id) {
    const category = await db
      .selectFrom('categories')
      .select('id')
      .where('id', '=', input.category_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!category) throw new AppError('That category was not found.', 400, 'CATEGORY_NOT_FOUND');
  }

  if (!requester.userId) {
    authRateLimiter.checkLimits([
      {
        key: `product_request_ip:${requester.ip ?? 'unknown'}`,
        max: PRODUCT_REQUEST_LIMITS.guestPerIpPerHour,
        windowMs: 60 * 60 * 1000,
        message: 'Too many requests from this device. Please try again later.',
      },
      {
        key: `product_request_ip_day:${requester.ip ?? 'unknown'}`,
        max: PRODUCT_REQUEST_LIMITS.guestPerIpPerDay,
        windowMs: 24 * 60 * 60 * 1000,
        message: 'Too many requests from this device today. Please try again tomorrow.',
      },
    ]);
  }

  return await db.transaction().execute(async (trx) => {
    const userId = requester.userId;
    if (userId) {
      // one at a time per customer, so two quick taps cannot pass the daily limit together
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`product_request:${userId}`}))`.execute(trx);
      const open = await trx
        .selectFrom('product_requests')
        .selectAll()
        .where('user_id', '=', userId)
        .where(sql<boolean>`name_key = ${keyOf(input.name)}`)
        .where('status', 'in', ['NEW', 'PLANNED'])
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (open) return { request: publicRequest(open), already_requested: true };
      const today = await trx
        .selectFrom('product_requests')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('user_id', '=', userId)
        .where('created_at', '>', sql<Date>`now() - interval '24 hours'`)
        .executeTakeFirstOrThrow();
      if (today.n >= PRODUCT_REQUEST_LIMITS.perCustomerPerDay) {
        throw new AppError(
          `You can ask for ${PRODUCT_REQUEST_LIMITS.perCustomerPerDay} products a day. Try again tomorrow.`,
          429,
          'TOO_MANY_PRODUCT_REQUESTS',
          { max_per_day: PRODUCT_REQUEST_LIMITS.perCustomerPerDay }
        );
      }
    }

    // join the group's PLANNED / ADDED decision; anything else starts as NEW
    const group = await trx
      .selectFrom('product_requests')
      .select(['status', 'product_id', 'staff_note'])
      .where(sql<boolean>`name_key = ${keyOf(input.name)}`)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const inherit = group && (group.status === 'PLANNED' || group.status === 'ADDED');
    const row = await trx
      .insertInto('product_requests')
      .values({
        user_id: userId,
        name: input.name,
        note: input.note,
        category_id: input.category_id,
        status: inherit ? group.status : 'NEW',
        product_id: inherit && group.status === 'ADDED' ? group.product_id : null,
        staff_note: inherit ? group.staff_note : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { request: publicRequest(row), already_requested: false };
  });
}

type RequestRow = {
  id: string;
  name: string;
  note: string | null;
  category_id: string | null;
  status: ProductRequestStatus;
  product_id: string | null;
  created_at: Date;
  updated_at: Date;
};

/** What the customer sees of a request (never the staff note). */
function publicRequest(r: RequestRow) {
  return {
    id: r.id,
    name: r.name,
    note: r.note,
    category_id: r.category_id,
    status: r.status,
    product_id: r.status === 'ADDED' ? r.product_id : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function myProductRequests(userId: string) {
  const rows = await db
    .selectFrom('product_requests as r')
    .leftJoin('categories as c', 'c.id', 'r.category_id')
    .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'r.product_id').on('p.deleted_at', 'is', null))
    .select([
      'r.id',
      'r.name',
      'r.note',
      'r.category_id',
      'r.status',
      'r.product_id',
      'r.created_at',
      'r.updated_at',
      'c.name as category_name',
      'p.name as product_name',
      'p.slug as product_slug',
      'p.image_url as product_image_url',
    ])
    .where('r.user_id', '=', userId)
    .orderBy('r.created_at', 'desc')
    .limit(100)
    .execute();
  return rows.map((r) => {
    const added = r.status === 'ADDED' && r.product_id && r.product_name;
    return {
      ...publicRequest(r),
      category_name: r.category_name ?? null,
      product: added ? { id: r.product_id!, name: r.product_name!, slug: r.product_slug, image_url: r.product_image_url } : null,
    };
  });
}

// ----------------------------------------------------------------------------
// Staff side
// ----------------------------------------------------------------------------

interface GroupRow {
  key: string;
  name: string;
  count: number;
  requests_total: number;
  last_requested_at: Date;
  first_requested_at: Date;
  status: ProductRequestStatus;
  category_id: string | null;
  category_name: string | null;
  product_id: string | null;
  product_name: string | null;
  staff_note: string | null;
}

async function groupRows(filter: { keys?: string[]; status?: ProductRequestStatus; sort: 'popular' | 'newest'; limit: number }) {
  const where = [
    filter.status ? sql`g.status = ${filter.status}` : sql`true`,
    filter.keys ? sql`g.key = ANY(${filter.keys}::text[])` : sql`true`,
  ];
  const order =
    filter.sort === 'newest'
      ? sql`g.last_requested_at DESC, g.count DESC, g.key`
      : sql`g.count DESC, g.last_requested_at DESC, g.key`;
  const r = await sql<GroupRow>`
    WITH g AS (
      SELECT r.name_key AS key,
             (array_agg(r.name ORDER BY r.created_at DESC))[1] AS name,
             count(DISTINCT coalesce(r.user_id::text, r.id::text))::int AS count,
             count(*)::int AS requests_total,
             max(r.created_at) AS last_requested_at,
             min(r.created_at) AS first_requested_at,
             (array_agg(r.status ORDER BY r.created_at DESC))[1] AS status,
             (array_agg(r.category_id ORDER BY r.created_at DESC) FILTER (WHERE r.category_id IS NOT NULL))[1] AS category_id,
             (array_agg(r.product_id ORDER BY r.updated_at DESC, r.created_at DESC) FILTER (WHERE r.product_id IS NOT NULL))[1] AS product_id,
             (array_agg(r.staff_note ORDER BY r.updated_at DESC, r.created_at DESC) FILTER (WHERE r.staff_note IS NOT NULL))[1] AS staff_note
      FROM product_requests r
      GROUP BY r.name_key
    )
    SELECT g.key, g.name, g.count, g.requests_total, g.last_requested_at, g.first_requested_at, g.status,
           g.category_id, c.name AS category_name,
           CASE WHEN g.status = 'ADDED' THEN g.product_id END AS product_id,
           CASE WHEN g.status = 'ADDED' THEN p.name END AS product_name,
           g.staff_note
    FROM g
    LEFT JOIN categories c ON c.id = g.category_id
    LEFT JOIN products p ON p.id = g.product_id
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY ${order}
    LIMIT ${filter.limit}`.execute(db);
  return r.rows;
}

async function withRequests(groups: GroupRow[]) {
  if (groups.length === 0) return [];
  const keys = groups.map((g) => g.key);
  const rows = await sql<{
    id: string;
    key: string;
    name: string;
    note: string | null;
    category_id: string | null;
    category_name: string | null;
    status: ProductRequestStatus;
    created_at: Date;
    user_id: string | null;
    customer_name: string | null;
    customer_phone: string | null;
  }>`
    SELECT x.id, x.key, x.name, x.note, x.category_id, x.category_name, x.status, x.created_at, x.user_id,
           x.customer_name, x.customer_phone
    FROM (
      SELECT r.id, r.name_key AS key, r.name, r.note, r.category_id, c.name AS category_name, r.status, r.created_at,
             r.user_id, u.full_name AS customer_name, u.phone AS customer_phone,
             row_number() OVER (PARTITION BY r.name_key ORDER BY r.created_at DESC) AS n
      FROM product_requests r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.name_key = ANY(${keys}::text[])
    ) x
    WHERE x.n <= ${PRODUCT_REQUEST_LIMITS.requestsPerGroup}
    ORDER BY x.created_at DESC`.execute(db);
  const byKey = new Map<string, unknown[]>();
  for (const r of rows.rows) {
    const list = byKey.get(r.key) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      note: r.note,
      category_id: r.category_id,
      category_name: r.category_name,
      status: r.status,
      created_at: r.created_at,
      guest: r.user_id === null,
      customer: r.user_id ? { id: r.user_id, name: r.customer_name, phone: publicPhone(r.customer_phone) } : null,
    });
    byKey.set(r.key, list);
  }
  return groups.map((g) => ({ ...g, requests: byKey.get(g.key) ?? [] }));
}

export async function listProductRequestGroups(query: unknown) {
  const q = listQuerySchema.parse(query ?? {});
  return withRequests(await groupRows({ status: q.status, sort: q.sort, limit: q.limit }));
}

/**
 * Tells every requester in the group (once per product, ever) that the product is here: a push to
 * their devices, else an SMS to a real Sri Lankan mobile. Each is its own savepoint - a failure is
 * logged and skipped, never failing the status change. Only when the product is live (active,
 * available, not deleted). Returns how many were queued.
 */
async function notifyRequesters(
  trx: Transaction<Database>,
  key: string,
  productId: string
): Promise<{ notified: number; skipped: string | null }> {
  const product = await trx
    .selectFrom('products')
    .select(['id', 'name'])
    .where('id', '=', productId)
    .where('is_active', '=', true)
    .where('is_available', '=', true)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) return { notified: 0, skipped: 'PRODUCT_NOT_LIVE' };
  const people = await trx
    .selectFrom('product_requests as r')
    .innerJoin('users as u', 'u.id', 'r.user_id')
    .select(['u.id', 'u.phone'])
    .distinct()
    .where(sql<boolean>`r.name_key = ${key}`)
    .where('u.role', '=', 'CUSTOMER')
    .where('u.is_active', '=', true)
    .execute();
  const name = product.name.length > 60 ? `${product.name.slice(0, 57)}...` : product.name;
  const push = isPushEnabled();
  let notified = 0;
  for (const person of people) {
    const idempotencyKey = `product-request:${product.id}:${person.id}`;
    const queued = await bestEffort(
      trx,
      async () => {
        if (push) {
          const sent = await enqueuePush(trx, {
            userId: person.id,
            type: PRODUCT_REQUEST_ADDED_PUSH,
            idempotencyKey,
            payload: {
              title: `${name} is now available`,
              body: 'You asked for it - it is on Blynk now. Tap to see it.',
              data: { type: 'product', product_id: product.id },
            },
          });
          if (sent) return true;
          // a device on record but the row already existed (told before): do not text as well
          const before = await trx.selectFrom('notifications').select('id').where('idempotency_key', '=', idempotencyKey).executeTakeFirst();
          if (before) return false;
        }
        let phone: string;
        try {
          phone = normalizeSriLankanPhone(person.phone);
        } catch {
          return false; // no SMS can reach it (or a deleted account's placeholder)
        }
        const now = new Date();
        const row = await trx
          .insertInto('notifications')
          .values({
            user_id: person.id,
            order_id: null,
            idempotency_key: idempotencyKey,
            channel: 'SMS',
            notification_type: PRODUCT_REQUEST_ADDED_SMS,
            recipient: phone,
            payload: JSON.stringify({ text: `Blynk: ${name} is now available. Order it in the Blynk app.`, product_id: product.id }),
            status: 'QUEUED',
            attempts: 0,
            max_attempts: 3,
            next_attempt_at: now,
            created_at: now,
            updated_at: now,
          } as never)
          .onConflict((oc) => oc.column('idempotency_key').doNothing())
          .returning('id')
          .executeTakeFirst();
        return !!row;
      },
      (err) => logger.error({ err, productId, userId: person.id }, 'Could not tell a requester the product is here; the change goes ahead')
    );
    if (queued) notified += 1;
  }
  return { notified, skipped: null };
}

export async function updateProductRequestGroup(rawKey: string, raw: unknown, actor: AuditActor) {
  const input = patchSchema.parse(raw);
  if (input.product_id && input.status !== 'ADDED') {
    throw new AppError('A product can be linked only when the status is ADDED.', 400, 'PRODUCT_ONLY_WHEN_ADDED');
  }
  if (input.product_id) {
    const product = await db
      .selectFrom('products')
      .select('id')
      .where('id', '=', input.product_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!product) throw new AppError('That product was not found.', 400, 'PRODUCT_NOT_FOUND');
  }

  const result = await db.transaction().execute(async (trx) => {
    const keyRow = await sql<{ key: string }>`SELECT ${keyOf(rawKey)} AS key`.execute(trx);
    const key = keyRow.rows[0]?.key ?? '';
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`product_request_group:${key}`}))`.execute(trx);
    const before = await trx
      .selectFrom('product_requests')
      .select(['id', 'status', 'product_id', 'staff_note'])
      .where(sql<boolean>`name_key = ${key}`)
      .orderBy('created_at', 'desc')
      .execute();
    if (before.length === 0) throw new AppError('No requests for that product.', 404, 'PRODUCT_REQUEST_NOT_FOUND');
    const previousProduct = before.find((r) => r.product_id)?.product_id ?? null;
    const productId =
      input.status === 'ADDED' ? (input.product_id !== undefined ? input.product_id : previousProduct) : null;

    const updated = await trx
      .updateTable('product_requests')
      .set({
        status: input.status,
        product_id: productId,
        ...(input.staff_note !== undefined ? { staff_note: input.staff_note } : {}),
        updated_at: new Date(),
      })
      .where(sql<boolean>`name_key = ${key}`)
      .executeTakeFirst();

    const notify = input.status === 'ADDED' && productId ? await notifyRequesters(trx, key, productId) : { notified: 0, skipped: null };

    await writeAudit(trx, actor, {
      action: 'PRODUCT_REQUESTS_UPDATED',
      entityType: 'product_request',
      entityId: before[0].id,
      oldValues: { key, status: before[0].status, product_id: previousProduct, staff_note: before[0].staff_note },
      newValues: {
        key,
        status: input.status,
        product_id: productId,
        ...(input.staff_note !== undefined ? { staff_note: input.staff_note } : {}),
        requests: Number(updated.numUpdatedRows),
        notified: notify.notified,
      },
    });
    return { key, updated: Number(updated.numUpdatedRows), ...notify };
  });

  const [group] = await withRequests(await groupRows({ keys: [result.key], sort: 'popular', limit: 1 }));
  return { group, updated: result.updated, notified: result.notified, notify_skipped: result.skipped };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

/** 503 PRODUCT_REQUESTS_NOT_READY until migration 056 has run. */
const ready = (_req: Request, _res: Response, next: NextFunction) => {
  hasProductRequestsTable()
    .then((ok) => next(ok ? undefined : productRequestsNotReady()))
    .catch(() => next(productRequestsNotReady()));
};

/** Signed in when a token is sent (a bad or expired one is a 401, so the app refreshes it); a guest otherwise. */
const authIfToken = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers.authorization) return requireAuth(req, res, next);
  next();
};

const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

/** Mounted at /product-requests. */
export const productRequestsRouter = Router();
productRequestsRouter.post(
  '/',
  authIfToken,
  ready,
  wrap(async (req, res) => {
    if (req.user && req.user.role !== 'CUSTOMER') {
      throw new AppError('Only customers can ask for products.', 403, 'FORBIDDEN');
    }
    const result = await createProductRequest({ userId: req.user?.id ?? null, ip: clientIp(req) }, req.body);
    res.status(201).json({ success: true, data: result });
  })
);

/** Mounted at /me. */
export const productRequestsMeRouter = Router();
productRequestsMeRouter.get(
  '/product-requests',
  requireAuth,
  requireRoles(['CUSTOMER']),
  ready,
  wrap(async (req, res) => {
    res.json({ success: true, data: { requests: await myProductRequests(req.user!.id) } });
  })
);

/** Mounted at /admin. */
export const adminProductRequestsRouter = Router();
const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), ready];
adminProductRequestsRouter.get(
  '/product-requests',
  ...STAFF,
  wrap(async (req, res) => {
    res.json({ success: true, data: { groups: await listProductRequestGroups(req.query) } });
  })
);
adminProductRequestsRouter.patch(
  '/product-requests/:key',
  ...STAFF,
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateProductRequestGroup(String(req.params.key), req.body, actorOf(req)) });
  })
);
