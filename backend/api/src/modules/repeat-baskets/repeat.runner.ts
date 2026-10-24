import type { Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, RepeatRunStatus } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { storeStatusAt } from '../../utils/store-hours.js';
import { orderingClock } from '../../utils/time.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import { bestEffort, enqueuePush } from '../notifications/push/push.repository.js';
import { orderService } from '../orders/order.service.js';
import { checkLines, describeLeftOut, orderLinesOf } from './repeat.lines.js';
import { repeatBasketsReady } from './repeat.ready.js';
import { basketQuery, specOf, type BasketRow } from './repeat.service.js';
import { nextRunAfter } from './repeat.schedule.js';

/**
 * The repeat basket worker (migration 054; contract docs/superpowers/plans/
 * 2026-10-24-buy-again-repeat.md section 2). Every minute, each ACTIVE basket
 * whose next_run_at has come:
 *  - "Skip next" on: run SKIPPED ("Skipped by you"), skip_next cleared, no message;
 *  - store closed / holiday / "close now" at that moment: SKIPPED ("Store closed"), customer told;
 *  - otherwise a normal cash-on-delivery, as-soon-as-possible order is placed AS
 *    THE CUSTOMER through orderService.createOrder (prices, offers, birthday gift,
 *    referral reward, delivery fee incl. pickup points, free deliveries,
 *    availability windows, stock). Lines that cannot be ordered now are left out
 *    and named in the run reason; nothing orderable -> SKIPPED. The order carries
 *    orders.repeat_basket_id; staff get the normal new-order alert.
 *  - then next_run_at moves on (DAILY +1 day, WEEKLY +7, BIWEEKLY +14 at place_at).
 * The customer gets a push and an SMS (outbox) for placed / skipped / failed.
 *
 * One instance at a time per basket: each basket is claimed with FOR NO KEY
 * UPDATE SKIP LOCKED (NO KEY, so the order's foreign key to the basket does not
 * wait on it), and the order's idempotency key is the basket + due time, so a
 * crash or a second worker can never place one due time twice.
 */
export const REPEAT_RUNNER_INTERVAL_MS = 60_000;
const BATCH = 50;
export const REPEAT_SMS_TYPE = 'REPEAT_BASKET';
export const REPEAT_PUSH_TYPE = 'PUSH_REPEAT_BASKET';

/** Order errors that name one line: that line is left out and the order tried again. */
const LINE_ERRORS = new Set([
  'PRODUCT_UNAVAILABLE',
  'PRODUCT_OUTSIDE_HOURS',
  'VARIANT_NOT_FOUND',
  'VARIANT_UNAVAILABLE',
  'VARIANT_REQUIRED',
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
]);

type Trx = Transaction<Database>;

interface Outcome {
  status: RepeatRunStatus;
  reason: string | null;
  order?: { id: string; order_number: string; total_amount: number };
  notify: boolean;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);
const lkr = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Places the basket's order (or says why not). Never throws. */
async function placeBasket(basket: BasketRow, runAt: Date, now: Date): Promise<Outcome> {
  try {
    const user = await db.selectFrom('users').select(['is_active']).where('id', '=', basket.user_id).executeTakeFirst();
    if (!user?.is_active) return { status: 'FAILED', reason: 'The account is not active', notify: false };
    if (!basket.address_id) return { status: 'FAILED', reason: 'The delivery address was removed', notify: true };

    const checks = await checkLines(basket.items, now);
    const leftOut = checks.filter((c) => !c.ok);
    let lines = checks.filter((c) => c.ok);
    if (lines.length === 0) {
      return { status: 'SKIPPED', reason: clip(`Nothing could be ordered: ${describeLeftOut(checks)}`, 300), notify: true };
    }

    const idempotencyKey = `repeat:${basket.id}:${runAt.getTime()}`;
    for (let attempt = 0; attempt <= basket.items.length; attempt++) {
      try {
        const { order } = await orderService.createOrder(
          basket.user_id,
          {
            address_id: basket.address_id,
            items: orderLinesOf(lines.map((c) => c.line)),
            customer_notes: basket.notes ?? null,
            idempotency_key: idempotencyKey,
            payment_method: 'COD',
          },
          undefined,
          { repeatBasketId: basket.id }
        );
        const reason = leftOut.length ? clip(`Left out: ${describeLeftOut([...leftOut])}`, 300) : null;
        return {
          status: 'PLACED',
          reason,
          order: { id: order.id, order_number: order.order_number, total_amount: Number(order.total_amount) },
          notify: true,
        };
      } catch (err) {
        if (err instanceof AppError && LINE_ERRORS.has(err.code)) {
          const d = (err.details ?? {}) as { product_id?: string; variant_id?: string | null };
          const i = lines.findIndex(
            (c) => c.line.product_id === d.product_id && (d.variant_id === undefined || (c.line.variant_id ?? null) === (d.variant_id ?? null))
          );
          if (i >= 0) {
            const [gone] = lines.splice(i, 1);
            leftOut.push({
              ...gone,
              ok: false,
              reason: err.code === 'OUT_OF_STOCK' ? 'sold out' : err.code === 'INSUFFICIENT_STOCK' ? 'not enough in stock' : 'not available now',
            });
            if (lines.length === 0) {
              return { status: 'SKIPPED', reason: clip(`Nothing could be ordered: ${describeLeftOut(leftOut)}`, 300), notify: true };
            }
            continue;
          }
        }
        if (err instanceof AppError && err.code === 'STORE_CLOSED') return { status: 'SKIPPED', reason: 'Store closed', notify: true };
        if (err instanceof AppError && err.statusCode < 500) {
          return { status: 'FAILED', reason: clip(err.message, 300), notify: true };
        }
        throw err;
      }
    }
    return { status: 'FAILED', reason: 'The order could not be placed', notify: true };
  } catch (err) {
    logger.error({ err, basketId: basket.id }, 'Repeat basket order failed');
    return { status: 'FAILED', reason: 'Something went wrong placing the order', notify: true };
  }
}

/** The texts the customer gets (push title/body, SMS) for an outcome. */
export function repeatMessages(name: string, outcome: Pick<Outcome, 'status' | 'reason' | 'order'>) {
  if (outcome.status === 'PLACED' && outcome.order) {
    const total = lkr(outcome.order.total_amount);
    return {
      title: 'Repeat basket ordered',
      body: `'${name}' is ordered - order ${outcome.order.order_number}, LKR ${total}.${outcome.reason ? ` ${outcome.reason}.` : ''}`,
      sms: `Blynk: your repeat basket '${name}' is ordered - order ${outcome.order.order_number}, LKR ${total}. Change or skip it in the app.`,
    };
  }
  const reason = outcome.reason ?? 'not placed';
  if (outcome.status === 'SKIPPED') {
    return {
      title: 'Repeat basket skipped',
      body: `'${name}' was not ordered this time: ${reason}.`,
      sms: `Blynk: your repeat basket '${name}' was skipped - ${clip(reason, 90)}. Change or skip it in the app.`,
    };
  }
  return {
    title: 'Repeat basket not ordered',
    body: `We could not order '${name}': ${reason}.`,
    sms: `Blynk: we could not order your repeat basket '${name}' - ${clip(reason, 90)}. Please check it in the app.`,
  };
}

async function notifyCustomer(trx: Trx, basket: BasketRow, runId: string, outcome: Outcome): Promise<void> {
  const text = repeatMessages(basket.name, outcome);
  await bestEffort(
    trx,
    async () => {
      await enqueuePush(trx, {
        userId: basket.user_id,
        orderId: outcome.order?.id ?? null,
        type: REPEAT_PUSH_TYPE,
        idempotencyKey: `repeat-push:${runId}`,
        payload: {
          title: text.title,
          body: text.body,
          data: outcome.order
            ? { type: 'order', order_id: outcome.order.id, basket_id: basket.id }
            : { type: 'repeat_basket', basket_id: basket.id },
        },
      });
      const user = await trx.selectFrom('users').select('phone').where('id', '=', basket.user_id).executeTakeFirst();
      let phone: string | null = null;
      try {
        phone = user?.phone ? normalizeSriLankanPhone(user.phone) : null;
      } catch {
        phone = null; // placeholder / foreign number: push only
      }
      if (!phone) return;
      await trx
        .insertInto('notifications')
        .values({
          user_id: basket.user_id,
          order_id: outcome.order?.id ?? null,
          idempotency_key: `repeat-sms:${runId}`,
          channel: 'SMS',
          notification_type: REPEAT_SMS_TYPE,
          recipient: phone,
          payload: JSON.stringify({ text: text.sms, basket_id: basket.id }),
          status: 'QUEUED',
        } as never)
        .onConflict((oc) => oc.column('idempotency_key').doNothing())
        .execute();
    },
    (err) => logger.error({ err, basketId: basket.id }, 'Could not queue the repeat basket messages')
  );
}

/** One due basket, inside its claiming transaction. */
async function runBasket(trx: Trx, basket: BasketRow, now: Date): Promise<RepeatRunStatus> {
  const runAt = basket.next_run_at!;
  let outcome: Outcome;
  if (basket.skip_next) {
    outcome = { status: 'SKIPPED', reason: 'Skipped by you', notify: false };
  } else {
    const status = storeStatusAt(await storeSchedule.read(), now);
    outcome = status.is_open_now ? await placeBasket(basket, runAt, now) : { status: 'SKIPPED', reason: 'Store closed', notify: true };
  }

  const run = await trx
    .insertInto('repeat_basket_runs')
    .values({ basket_id: basket.id, run_at: runAt, status: outcome.status, order_id: outcome.order?.id ?? null, reason: outcome.reason })
    .onConflict((oc) => oc.columns(['basket_id', 'run_at']).doNothing())
    .returning('id')
    .executeTakeFirst();

  await trx
    .updateTable('repeat_baskets')
    .set({
      next_run_at: nextRunAfter(specOf(basket), runAt, now),
      last_run_at: now,
      skip_next: false,
      ...(outcome.order ? { last_order_id: outcome.order.id } : {}),
      updated_at: new Date(),
    })
    .where('id', '=', basket.id)
    .execute();

  if (run && outcome.notify) await notifyCustomer(trx, basket, run.id, outcome);
  logger.info({ basketId: basket.id, runAt, status: outcome.status, orderId: outcome.order?.id, reason: outcome.reason }, 'Repeat basket run');
  return outcome.status;
}

/**
 * Runs every due basket (at most BATCH per call). `basketIds` limits the run
 * to those baskets (tests, manual runs). Returns the counts.
 */
export async function runDueRepeatBaskets(opts: { now?: Date; basketIds?: string[] } = {}) {
  const counts = { placed: 0, skipped: 0, failed: 0 };
  if (!(await repeatBasketsReady())) return counts;
  const now = opts.now ?? orderingClock.now();
  for (let i = 0; i < BATCH; i++) {
    const status = await db.transaction().execute(async (trx) => {
      let q = basketQuery(trx).where('status', '=', 'ACTIVE').where('next_run_at', '<=', now);
      if (opts.basketIds) q = q.where('id', 'in', opts.basketIds.length ? opts.basketIds : ['00000000-0000-0000-0000-000000000000']);
      const basket = (await q.orderBy('next_run_at', 'asc').orderBy('id', 'asc').limit(1).forNoKeyUpdate().skipLocked().executeTakeFirst()) as
        | BasketRow
        | undefined;
      if (!basket) return null;
      return await runBasket(trx, basket, now);
    });
    if (!status) break;
    if (status === 'PLACED') counts.placed++;
    else if (status === 'SKIPPED') counts.skipped++;
    else counts.failed++;
  }
  return counts;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = runDueRepeatBaskets()
    .catch((err) => {
      // Before migration 054 the tables do not exist (the ready check normally catches it).
      const code = (err as { code?: string }).code;
      if (code === '42P01' || code === '42703') return;
      logger.error({ err }, 'Repeat basket run failed');
    })
    .finally(() => {
      running = null;
    });
  await running;
}

/** Worker tick (worker.ts), every minute - same pattern as the PayHere payment expiry job. */
export const repeatBasketJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), REPEAT_RUNNER_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
