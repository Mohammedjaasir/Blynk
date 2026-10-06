import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import {
  MAX_OFFER_TEXT,
  SMS_LANGUAGES,
  SMS_OFFER_AUDIENCES,
  estimateOffer,
  listOffers,
  sendOffer,
  sendTestOffer,
} from './sms-offers.service.js';

/** SMS offers (migration 027): Admin and Operations, mounted under /admin. */
export const smsOffersRouter = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const language = z.enum(SMS_LANGUAGES as [string, ...string[]]);
const text = z.string().trim().max(MAX_OFFER_TEXT, `Keep each text under ${MAX_OFFER_TEXT} characters`);
const offerSchema = z.object({
  audience: z.enum(SMS_OFFER_AUDIENCES as [string, ...string[]]),
  fallback_language: language,
  messages: z.object({ si: text.optional(), ta: text.optional(), en: text.optional() }),
});
type OfferBody = z.infer<typeof offerSchema>;

/** Who would get it, in which language, and how many SMS parts it costs. */
smsOffersRouter.post(
  '/sms-offers/estimate',
  ...STAFF,
  validate({ body: offerSchema }),
  wrap(async (req, res) => {
    const body = req.body as OfferBody;
    const estimate = await estimateOffer(body.audience as never, body.fallback_language as never, body.messages);
    res.json({ success: true, data: { estimate } });
  })
);

smsOffersRouter.post(
  '/sms-offers/test',
  ...STAFF,
  validate({ body: z.object({ language, message: text.min(1, 'Write the text to test') }) }),
  wrap(async (req, res) => {
    const result = await sendTestOffer(actorOf(req), req.body.language, req.body.message);
    res.status(202).json({ success: true, data: result });
  })
);

smsOffersRouter.post(
  '/sms-offers',
  ...STAFF,
  validate({ body: offerSchema }),
  wrap(async (req, res) => {
    const body = req.body as OfferBody;
    const offer = await sendOffer(actorOf(req), {
      audience: body.audience as never,
      fallback_language: body.fallback_language as never,
      messages: body.messages,
    });
    res.status(201).json({ success: true, data: { offer } });
  })
);

smsOffersRouter.get(
  '/sms-offers',
  ...STAFF,
  wrap(async (_req, res) => {
    res.json({ success: true, data: { offers: await listOffers() } });
  })
);
