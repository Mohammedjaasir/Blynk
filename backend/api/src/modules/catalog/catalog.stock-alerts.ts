import type { Request, Response, NextFunction } from 'express';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * "Notify me when it's back" (phase 6, migration 022). A signed-in customer
 * subscribes to a sold-out product; when it is available again the customer
 * gets one push (notifications/push/push.events.ts releaseStockAlerts).
 */
export const stockAlertRepository = {
  /** Whether the user has a pending (not yet sent) alert for the product. */
  async isSubscribed(userId: string, productId: string): Promise<boolean> {
    const row = await db
      .selectFrom('stock_alerts')
      .select('id')
      .where('user_id', '=', userId)
      .where('product_id', '=', productId)
      .where('notified_at', 'is', null)
      .executeTakeFirst();
    return !!row;
  },

  /** Subscribes, or re-arms an alert that already fired. */
  async subscribe(userId: string, productId: string) {
    const now = new Date();
    await db
      .insertInto('stock_alerts')
      .values({ user_id: userId, product_id: productId, created_at: now, notified_at: null })
      .onConflict((oc) => oc.columns(['user_id', 'product_id']).doUpdateSet({ created_at: now, notified_at: null }))
      .execute();
  },

  async unsubscribe(userId: string, productId: string) {
    await db.deleteFrom('stock_alerts').where('user_id', '=', userId).where('product_id', '=', productId).execute();
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function customerVisibleProduct(id: string) {
  if (!UUID.test(id)) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  const product = await db
    .selectFrom('v_product_catalog')
    .select(['id', 'is_available', 'is_active'])
    .where('id', '=', id)
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return product;
}

export const stockAlertController = {
  /** POST /catalog/products/:id/notify-me */
  async subscribe(req: Request, res: Response, next: NextFunction) {
    try {
      const product = await customerVisibleProduct(String(req.params.id));
      if (product.is_available) {
        throw new AppError('This product is available now.', 409, 'PRODUCT_AVAILABLE', { product_id: product.id });
      }
      await stockAlertRepository.subscribe(req.user!.id, product.id);
      res.status(200).json({ success: true, data: { notify_me_subscribed: true } });
    } catch (err) {
      next(err);
    }
  },

  /** DELETE /catalog/products/:id/notify-me */
  async unsubscribe(req: Request, res: Response, next: NextFunction) {
    try {
      if (!UUID.test(String(req.params.id))) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
      await stockAlertRepository.unsubscribe(req.user!.id, String(req.params.id));
      res.status(200).json({ success: true, data: { notify_me_subscribed: false } });
    } catch (err) {
      next(err);
    }
  },
};
