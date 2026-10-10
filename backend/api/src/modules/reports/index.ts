import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { resolveSalesRange, salesReport, type SalesRangePreset } from './sales.service.js';
import { exportCustomers, getCustomer, listCustomers, type CustomerSort } from './customers.service.js';
import { DASHBOARD_RANGES, salesDashboard, type DashboardRange } from './dashboard.service.js';
import { ORDER_MAP_RANGES, orderMap, type OrderMapRange } from './order-map.service.js';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

/** A preset, or explicit Asia/Colombo dates (from/to inclusive, at most 366 days). */
export const salesQuerySchema = z
  .object({
    range: z.enum(['today', 'yesterday', 'last_7_days', 'last_30_days']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.from === undefined) !== (v.to === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Send both from and to' });
    }
    if (v.from && v.to) {
      const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
      if (days < 0) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
      if (days > 366) ctx.addIssue({ code: 'custom', path: ['to'], message: 'At most 366 days' });
    }
  });

const page = z.coerce.number().int().min(1).default(1);
const limit = (max: number, dflt: number) => z.coerce.number().int().min(1).max(max).default(dflt);

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(64).optional(),
  sort: z.enum(['recent', 'spend', 'orders', 'name']).default('recent'),
  page,
  limit: limit(100, 25),
});

export const customerDetailQuerySchema = z.object({ page, limit: limit(100, 20) });

// ----------------------------------------------------------------------------
// ADMIN REPORTS (mounted under /api/v1/admin). ADMIN only: revenue figures,
// customer names and phone numbers.
// ----------------------------------------------------------------------------
export const adminReportsRouter = Router();
const ADMIN_ONLY = [requireAuth, requireRoles('ADMIN')];

adminReportsRouter.get(
  '/reports/sales',
  ...ADMIN_ONLY,
  validate({ query: salesQuerySchema }),
  wrap(async (req, res) => {
    const q = req.query as z.infer<typeof salesQuerySchema>;
    const range =
      q.from && q.to ? { from: q.from, to: q.to } : resolveSalesRange((q.range ?? 'today') as SalesRangePreset);
    res.json({ success: true, data: await salesReport(range) });
  })
);

// Sales dashboard and delivery heat map (owner, 2026-10-10): ADMIN and
// OPERATIONS - the Ops app shows them on the phone. Aggregates only; the map
// never carries names, phones, addresses or exact points.
const ADMIN_OR_OPS = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];

export const dashboardQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES as [DashboardRange, ...DashboardRange[]]).default('today'),
});

adminReportsRouter.get(
  '/reports/dashboard',
  ...ADMIN_OR_OPS,
  validate({ query: dashboardQuerySchema }),
  wrap(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof dashboardQuerySchema>;
    res.json({ success: true, data: await salesDashboard(q.range ?? 'today') });
  })
);

export const orderMapQuerySchema = z.object({
  range: z.enum(ORDER_MAP_RANGES as [OrderMapRange, ...OrderMapRange[]]).default('last_30_days'),
  status: z.enum(['delivered', 'all']).default('delivered'),
});

adminReportsRouter.get(
  '/reports/order-map',
  ...ADMIN_OR_OPS,
  validate({ query: orderMapQuerySchema }),
  wrap(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof orderMapQuerySchema>;
    res.json({ success: true, data: await orderMap(q.range ?? 'last_30_days', q.status ?? 'delivered') });
  })
);

adminReportsRouter.get(
  '/customers',
  ...ADMIN_ONLY,
  validate({ query: customerListQuerySchema }),
  wrap(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof customerListQuerySchema>;
    res.json({ success: true, data: await listCustomers({ ...q, sort: q.sort as CustomerSort }) });
  })
);

// Before /customers/:id, which would read "export" as an id.
adminReportsRouter.get(
  '/customers/export',
  ...ADMIN_ONLY,
  wrap(async (_req, res) => {
    res.json({ success: true, data: await exportCustomers() });
  })
);

adminReportsRouter.get(
  '/customers/:id',
  ...ADMIN_ONLY,
  validate({ params: z.object({ id: z.string().uuid('Invalid customer ID') }), query: customerDetailQuerySchema }),
  wrap(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof customerDetailQuerySchema>;
    res.json({ success: true, data: await getCustomer(req.params.id as string, q) });
  })
);

export * from './sales.service.js';
export * from './customers.service.js';
export * from './dashboard.service.js';
export * from './order-map.service.js';
