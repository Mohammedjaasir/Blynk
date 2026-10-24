import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { dailyReportService, updateDailyReportSchema } from '../configuration/daily-report.js';
import { previewDailyReport, sendDailyReportNow } from './daily-report.sender.js';

/*
 * The daily report (owner, 2026-10-25), mounted under /admin, ADMIN and OPERATIONS:
 *   GET  /admin/settings/daily-report   { enabled, send_at, phones, last_sent_*, last_manual_at }
 *   PUT  /admin/settings/daily-report   { enabled?, send_at?, phones? } (audited DAILY_REPORT_UPDATED)
 *   POST /admin/daily-report/preview    { date, text, chars, parts } - today so far, nothing is sent
 *   POST /admin/daily-report/send-now   sends it to the saved numbers; 429 within 2 minutes (audited)
 * No migration; nothing here touches /store.
 */
const actorOf = (req: Request) => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const staff = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];

export const adminDailyReportRouter = Router();

adminDailyReportRouter.get('/settings/daily-report', ...staff, async (_req, res, next) => {
  try {
    res.json({ success: true, data: await dailyReportService.get() });
  } catch (err) {
    next(err);
  }
});

adminDailyReportRouter.put('/settings/daily-report', ...staff, async (req, res, next) => {
  try {
    const input = updateDailyReportSchema.parse(req.body);
    res.json({ success: true, data: await dailyReportService.set(input, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

adminDailyReportRouter.post('/daily-report/preview', ...staff, async (_req, res, next) => {
  try {
    res.json({ success: true, data: await previewDailyReport() });
  } catch (err) {
    next(err);
  }
});

adminDailyReportRouter.post('/daily-report/send-now', ...staff, async (req, res, next) => {
  try {
    res.json({ success: true, data: await sendDailyReportNow(actorOf(req)) });
  } catch (err) {
    next(err);
  }
});
