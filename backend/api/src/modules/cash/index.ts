import { Router, type Request, type Response, type NextFunction } from 'express';
import { sql } from 'kysely';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { AppError } from '../../middleware/error.middleware.js';
import { publicPhone } from '../../utils/phone.js';
import { rangeBounds, STORE_ZONE } from '../reports/sales.service.js';

/*
 * Rider cash reconciliation (migration 019). Riders collect COD cash - the
 * record of it is deliveries.cod_collected_amount, set when a delivery is
 * settled (the rider's collect-cod, or an admin marking it delivered) with
 * delivered_at. Staff record what each rider hands in (cash_handins); the
 * reconciliation compares the two per rider per Asia/Colombo day.
 *
 * Commission riders keep their share (migration 032; owner, 2026-10-09): a
 * COMMISSION rider keeps what each delivery earned them out of the cash they
 * collected and hands in the rest. The rule, per rider per day (the same
 * scope as the reconciliation - deliveries settled that day):
 *
 *   kept_share      = sum over that day's delivered deliveries of
 *                     min(deliveries.rider_earning_lkr, cod_collected_amount)
 *   expected_handin = collected - kept_share
 *   difference      = handed_in - expected_handin   (negative = short)
 *
 * rider_earning_lkr is the snapshot written at settlement, so a later change
 * to the rider's pay never changes a past day. A COMPANY rider's earning is 0,
 * so for them expected_handin = collected, exactly as before. The min() means
 * a rider never keeps more than that door's cash (an order whose total is
 * below the share); any remainder is still on the earnings report.
 */

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const todayColombo = () => DateTime.now().setZone(STORE_ZONE).toISODate()!;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Invalid date');

export const createHandinSchema = z.object({
  rider_id: z.string().uuid('rider_id must be a valid UUID'),
  amount: z.coerce
    .number({ invalid_type_error: 'amount must be a number' })
    .positive('The amount must be above 0')
    .max(10_000_000)
    .transform((v) => Number(v.toFixed(2))),
  handin_date: isoDate
    .refine((v) => v <= todayColombo(), 'A hand-in cannot be dated in the future')
    .optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type CreateHandinInput = z.infer<typeof createHandinSchema>;

export const handinListQuerySchema = z.object({
  date: isoDate.optional(),
  rider_id: z.string().uuid().optional(),
});

export const reconciliationQuerySchema = z.object({ date: isoDate.optional() });

export type ReconciliationStatus = 'SHORT' | 'OVER' | 'BALANCED';

export function reconciliationStatus(difference: number): ReconciliationStatus {
  if (difference < -0.004) return 'SHORT';
  if (difference > 0.004) return 'OVER';
  return 'BALANCED';
}

const handinSelect = [
  'h.id',
  'h.rider_id',
  'u.full_name as rider_name',
  'h.amount',
  sql<string>`h.handin_date::text`.as('handin_date'),
  'h.note',
  'h.recorded_by_user_id',
  'rec.full_name as recorded_by_name',
  'h.created_at',
] as const;

function handinQuery() {
  return db
    .selectFrom('cash_handins as h')
    .innerJoin('riders as r', 'r.id', 'h.rider_id')
    .innerJoin('users as u', 'u.id', 'r.user_id')
    .leftJoin('users as rec', 'rec.id', 'h.recorded_by_user_id')
    .select(handinSelect);
}

const presentHandin = <T extends { amount: unknown }>(row: T) => ({ ...row, amount: money(row.amount) });

export async function createHandin(input: CreateHandinInput, userId: string) {
  // A rider request still waiting or rejected (migration 029) is not a rider.
  const rider = await db
    .selectFrom('riders')
    .select('id')
    .where('id', '=', input.rider_id)
    .where('approval_status', '=', 'APPROVED')
    .executeTakeFirst();
  if (!rider) throw new AppError('Rider not found.', 404, 'RIDER_NOT_FOUND');
  const row = await db
    .insertInto('cash_handins')
    .values({
      rider_id: input.rider_id,
      amount: input.amount,
      handin_date: input.handin_date ?? todayColombo(),
      note: input.note || null,
      recorded_by_user_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return presentHandin(await handinQuery().where('h.id', '=', row.id).executeTakeFirstOrThrow());
}

export async function listHandins(params: { date?: string; rider_id?: string }) {
  let q = handinQuery().where(sql`h.handin_date`, '=', params.date ?? todayColombo());
  if (params.rider_id) q = q.where('h.rider_id', '=', params.rider_id);
  return (await q.orderBy('h.created_at', 'desc').execute()).map(presentHandin);
}

/**
 * Per rider for one day: cash collected (settled deliveries by delivered_at,
 * Colombo day), the commission share kept, what should be handed in, handed
 * in (hand-ins dated that day) and the difference (handed in - expected
 * hand-in; negative = short). Riders with neither are left out.
 */
export async function reconciliation(date: string) {
  const { start, end } = rangeBounds({ from: date, to: date });
  const [collected, handed] = await Promise.all([
    db
      .selectFrom('deliveries')
      .select([
        'rider_id',
        sql<number>`count(*)::int`.as('deliveries'),
        sql<string>`sum(cod_collected_amount)`.as('collected'),
        sql<string>`coalesce(sum(least(coalesce(rider_earning_lkr, 0), cod_collected_amount)), 0)`.as('kept'),
      ])
      .where('assignment_status', '=', 'DELIVERED')
      .where('delivered_at', '>=', start)
      .where('delivered_at', '<', end)
      .groupBy('rider_id')
      .execute(),
    db
      .selectFrom('cash_handins')
      .select(['rider_id', sql<number>`count(*)::int`.as('handins'), sql<string>`sum(amount)`.as('handed_in')])
      .where(sql`handin_date`, '=', date)
      .groupBy('rider_id')
      .execute(),
  ]);
  const riderIds = [...new Set([...collected.map((c) => c.rider_id), ...handed.map((h) => h.rider_id)])];
  const names = riderIds.length
    ? await db
        .selectFrom('riders as r')
        .innerJoin('users as u', 'u.id', 'r.user_id')
        .select(['r.id', 'u.full_name', 'u.phone', 'r.pay_type'])
        .where('r.id', 'in', riderIds)
        .execute()
    : [];

  const riders = riderIds
    .map((id) => {
      const c = collected.find((x) => x.rider_id === id);
      const h = handed.find((x) => x.rider_id === id);
      const n = names.find((x) => x.id === id);
      const cash = money(c?.collected);
      const kept = money(c?.kept);
      const expected = money(cash - kept);
      const inHand = money(h?.handed_in);
      const difference = money(inHand - expected);
      return {
        rider_id: id,
        rider_name: n?.full_name ?? null,
        rider_phone: publicPhone(n?.phone),
        /** The rider's pay type now (each delivery's own snapshot decides kept_share). */
        pay_type: n?.pay_type ?? 'COMPANY',
        deliveries: c?.deliveries ?? 0,
        handins: h?.handins ?? 0,
        collected: cash,
        /** The commission rider's earned share they keep (0 for a company rider). */
        kept_share: kept,
        /** What should be handed in: collected - kept_share. */
        expected_handin: expected,
        handed_in: inHand,
        difference,
        status: reconciliationStatus(difference),
      };
    })
    .sort((a, b) => (a.rider_name ?? '').localeCompare(b.rider_name ?? '') || a.rider_id.localeCompare(b.rider_id));

  const collectedTotal = money(riders.reduce((s, r) => s + r.collected, 0));
  const keptTotal = money(riders.reduce((s, r) => s + r.kept_share, 0));
  const expectedTotal = money(collectedTotal - keptTotal);
  const handedTotal = money(riders.reduce((s, r) => s + r.handed_in, 0));
  return {
    date,
    timezone: STORE_ZONE,
    riders,
    totals: {
      collected: collectedTotal,
      kept_share: keptTotal,
      expected_handin: expectedTotal,
      handed_in: handedTotal,
      difference: money(handedTotal - expectedTotal),
      status: reconciliationStatus(handedTotal - expectedTotal),
    },
  };
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

// ----------------------------------------------------------------------------
// ADMIN / OPERATIONS CASH (mounted under /api/v1/admin)
// ----------------------------------------------------------------------------
export const adminCashRouter = Router();
const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];

adminCashRouter.post(
  '/cash/handins',
  ...STAFF,
  validate({ body: createHandinSchema }),
  wrap(async (req, res) => {
    const handin = await createHandin(req.body as CreateHandinInput, req.user!.id);
    res.status(201).json({ success: true, data: { handin } });
  })
);

adminCashRouter.get(
  '/cash/handins',
  ...STAFF,
  validate({ query: handinListQuerySchema }),
  wrap(async (req, res) => {
    const handins = await listHandins(req.query as z.infer<typeof handinListQuerySchema>);
    res.json({ success: true, data: { handins } });
  })
);

/** A mistyped hand-in is removed by an admin (and re-entered). */
adminCashRouter.delete(
  '/cash/handins/:id',
  requireAuth,
  requireRoles('ADMIN'),
  validate({ params: z.object({ id: z.string().uuid('Invalid hand-in ID') }) }),
  wrap(async (req, res) => {
    const deleted = await db.deleteFrom('cash_handins').where('id', '=', req.params.id as string).executeTakeFirst();
    if (!deleted.numDeletedRows) throw new AppError('Hand-in not found.', 404, 'HANDIN_NOT_FOUND');
    res.json({ success: true, data: { deleted: true } });
  })
);

adminCashRouter.get(
  '/cash/reconciliation',
  ...STAFF,
  validate({ query: reconciliationQuerySchema }),
  wrap(async (req, res) => {
    const { date } = req.query as z.infer<typeof reconciliationQuerySchema>;
    res.json({ success: true, data: await reconciliation(date ?? todayColombo()) });
  })
);
