import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { getRating, listRatings, rateOrder, ratingsSummary, tipFromWallet } from './ratings.service.js';
import {
  ratingInputSchema,
  ratingsSummaryQuerySchema,
  staffRatingsQuerySchema,
  tipInputSchema,
  type RatingInput,
  type StaffRatingsQuery,
} from './ratings.rules.js';

/*
 * Order ratings + rider tips (owner, 2026-10-24; migration 055).
 * Every route answers 503 RATINGS_NOT_READY until migration 055 exists.
 *
 *   customer (mounted under /orders, the order's own customer):
 *     GET  /orders/:id/rating   the rating card's state
 *     POST /orders/:id/rating   { stars, tags?, comment? } -> 201 new / 200 changed
 *     POST /orders/:id/tip      { amount_lkr } from the Blynk Wallet -> 201
 *   staff (mounted under /admin, ADMIN and OPERATIONS):
 *     GET  /admin/ratings?stars_max=&from=&to=&rider_id=&page=&limit=
 *     GET  /admin/ratings/summary?days=30
 */

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const orderParams = z.object({ id: z.string().uuid('Invalid order ID') });

export const orderRatingsRouter = Router();

orderRatingsRouter.get(
  '/:id/rating',
  requireAuth,
  validate({ params: orderParams }),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getRating(req.params.id as string, req.user!.id) });
  })
);

orderRatingsRouter.post(
  '/:id/rating',
  requireAuth,
  validate({ params: orderParams, body: ratingInputSchema }),
  wrap(async (req, res) => {
    const { created, state } = await rateOrder(req.params.id as string, req.user!.id, req.body as RatingInput);
    res.status(created ? 201 : 200).json({ success: true, data: state });
  })
);

orderRatingsRouter.post(
  '/:id/tip',
  requireAuth,
  validate({ params: orderParams, body: tipInputSchema }),
  wrap(async (req, res) => {
    const state = await tipFromWallet(req.params.id as string, req.user!.id, (req.body as { amount_lkr: number }).amount_lkr);
    res.status(201).json({ success: true, data: state });
  })
);

export const adminRatingsRouter = Router();
const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];

adminRatingsRouter.get(
  '/ratings/summary',
  ...STAFF,
  validate({ query: ratingsSummaryQuerySchema }),
  wrap(async (req, res) => {
    const { days } = req.query as unknown as z.infer<typeof ratingsSummaryQuerySchema>;
    res.json({ success: true, data: await ratingsSummary(days) });
  })
);

adminRatingsRouter.get(
  '/ratings',
  ...STAFF,
  validate({ query: staffRatingsQuerySchema }),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listRatings(req.query as unknown as StaffRatingsQuery) });
  })
);

export * from './ratings.ready.js';
export * from './ratings.rules.js';
export * from './ratings.service.js';
