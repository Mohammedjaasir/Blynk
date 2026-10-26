import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { AppError } from '../../middleware/error.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { detectImageType } from '../media/media.controller.js';
import { ALLOWED_IMAGE_TYPES, mediaStorage } from '../../utils/storage.js';
import {
  createProductSchema,
  editProductSchema,
  idParamSchema,
  profileSchema,
  statementQuerySchema,
} from './seller.schema.js';
import { sellerService } from './seller.service.js';
import { setProductStock, setStockSchema, stockParamSchema } from './seller.stock.js';
import {
  createPayoutRequestSchema,
  createStockNoteSchema,
  insightsQuerySchema,
  sellerStockNotesQuerySchema,
} from './seller-requests.schema.js';
import {
  cancelOwnStockNote,
  createPayoutRequest,
  createStockNote,
  listSellerPayoutRequests,
  listSellerStockNotes,
  sellerInsights,
  withdrawPayoutRequest,
} from './seller-requests.service.js';

/**
 * Seller-facing API (role SELLER), mounted at /api/v1/seller
 * (docs/superpowers/plans/2026-10-24-seller-portal.md). Sign-in is POST /auth/otp/verify with
 * app: 'seller'. Every route here acts only on the caller's own seller row.
 */
export const sellerRouter = Router();

/** Seller photos may be a little bigger than Admin's 2 MB cap: sellers upload from a phone camera. */
export const MAX_SELLER_IMAGE_BYTES = 5 * 1024 * 1024;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SELLER_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      callback(new AppError('Unsupported image type. Use JPEG, PNG or WebP.', 400, 'UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    callback(null, true);
  },
});

/** multer with this route's own size message (the global one says 2 MB). */
const uploadSingle: RequestHandler = (req, res, next) => {
  imageUpload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Photos must be 5 MB or smaller.', 413, 'FILE_TOO_LARGE'));
    }
    next(err as Error | undefined);
  });
};

const handle =
  (fn: (req: Request) => Promise<{ status?: number; data: unknown }>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const out = await fn(req);
      res.status(out.status ?? 200).json({ success: true, data: out.data });
    } catch (err) {
      next(err);
    }
  };

sellerRouter.use(requireAuth, requireRoles('SELLER'));

sellerRouter.get('/me', handle(async (req) => ({ data: await sellerService.me(req.user!.id) })));

sellerRouter.put(
  '/profile',
  validate({ body: profileSchema }),
  handle(async (req) => ({ data: await sellerService.updateProfile(req.user!.id, req.body) }))
);

sellerRouter.get('/categories', handle(async () => ({ data: await sellerService.categories() })));

sellerRouter.get('/products', handle(async (req) => ({ data: await sellerService.products(req.user!.id) })));

sellerRouter.post(
  '/products',
  validate({ body: createProductSchema }),
  handle(async (req) => ({ status: 201, data: await sellerService.createSubmission(req.user!.id, req.body) }))
);

sellerRouter.patch(
  '/products/:id',
  validate({ params: idParamSchema, body: editProductSchema }),
  handle(async (req) => ({ data: await sellerService.editSubmission(req.user!.id, String(req.params.id), req.body) }))
);

// Sellers type their own stock (owner, 2026-10-26; seller.stock.ts): the number becomes the live stock.
sellerRouter.put(
  '/products/:id/stock',
  validate({ params: stockParamSchema, body: setStockSchema }),
  handle(async (req) => ({
    data: await setProductStock(req.user!.id, String(req.params.id), req.body, {
      actorId: req.user!.id,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    }),
  }))
);

sellerRouter.delete(
  '/submissions/:id',
  validate({ params: idParamSchema }),
  handle(async (req) => ({ data: await sellerService.withdraw(req.user!.id, String(req.params.id)) }))
);

sellerRouter.post(
  '/uploads/image',
  uploadSingle,
  handle(async (req) => {
    const file = req.file;
    if (!file) throw new AppError('No image file was uploaded.', 400, 'NO_FILE');
    // The declared content type is attacker-controlled, so the file's own magic number decides.
    const contentType = detectImageType(file.buffer);
    if (!contentType || !ALLOWED_IMAGE_TYPES[contentType]) {
      throw new AppError('Unsupported image type. Use JPEG, PNG or WebP.', 400, 'UNSUPPORTED_MEDIA_TYPE');
    }
    const stored = await mediaStorage.save(file.buffer, contentType, 'products');
    return { status: 201, data: { url: stored.url } };
  })
);

sellerRouter.get(
  '/statement',
  validate({ query: statementQuerySchema }),
  handle(async (req) => {
    const { from, to } = req.query as { from?: string; to?: string };
    return { data: await sellerService.statement(req.user!.id, { from, to }) };
  })
);

// ----------------------------------------------------------------------------
// Stock notes (no longer used by the apps), payout requests (migration 057) and the dashboard
// (seller-requests.service.ts)
// ----------------------------------------------------------------------------

sellerRouter.post(
  '/stock-notes',
  validate({ body: createStockNoteSchema }),
  handle(async (req) => ({ status: 201, data: await createStockNote(req.user!.id, req.body) }))
);

sellerRouter.get(
  '/stock-notes',
  validate({ query: sellerStockNotesQuerySchema }),
  handle(async (req) => ({ data: await listSellerStockNotes(req.user!.id, (req.query as { status?: never }).status) }))
);

sellerRouter.delete(
  '/stock-notes/:id',
  validate({ params: idParamSchema }),
  handle(async (req) => ({ data: await cancelOwnStockNote(req.user!.id, String(req.params.id)) }))
);

sellerRouter.post(
  '/payout-requests',
  validate({ body: createPayoutRequestSchema }),
  handle(async (req) => ({ status: 201, data: await createPayoutRequest(req.user!.id, req.body) }))
);

sellerRouter.get('/payout-requests', handle(async (req) => ({ data: await listSellerPayoutRequests(req.user!.id) })));

sellerRouter.delete(
  '/payout-requests/:id',
  validate({ params: idParamSchema }),
  handle(async (req) => ({ data: await withdrawPayoutRequest(req.user!.id, String(req.params.id)) }))
);

sellerRouter.get(
  '/insights',
  validate({ query: insightsQuerySchema }),
  handle(async (req) => ({ data: await sellerInsights(req.user!.id, Number((req.query as { days?: number }).days ?? 7)) }))
);
