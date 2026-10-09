import { Request, Response, NextFunction } from 'express';
import { riderService } from './rider.service.js';
import { riderRepository } from './rider.repository.js';
import { updateDeliveryStatusSchema, collectCodSchema, deliveryParamsSchema } from './rider.schema.js';
import { updateLocationSchema } from './rider.location.schema.js';
import { riderLocationService } from './rider.location.service.js';
import { suggestRidersForOrder } from './rider.suggestions.service.js';
import { z } from 'zod';

export class RiderController {
  async getActiveDeliveries(req: Request, res: Response, next: NextFunction) {
    try {
      const deliveries = await riderService.getActiveDeliveries(req.user!.id);
      res.status(200).json({
        success: true,
        data: { deliveries },
      });
    } catch (err) {
      next(err);
    }
  }

  async getDeliveryById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = deliveryParamsSchema.parse(req.params);
      const delivery = await riderService.getDeliveryById(id, req.user!.id);
      res.status(200).json({
        success: true,
        data: { delivery },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateDeliveryStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = deliveryParamsSchema.parse(req.params);
      const input = updateDeliveryStatusSchema.parse(req.body);
      const delivery = await riderService.updateDeliveryStatus(
        id,
        // The verified token's own id and role - never anything from the body.
        { id: req.user!.id, role: req.user!.role },
        input.status,
        input.failure_reason
      );
      res.status(200).json({
        success: true,
        data: { delivery },
      });
    } catch (err) {
      next(err);
    }
  }

  async collectCod(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = deliveryParamsSchema.parse(req.params);
      const input = collectCodSchema.parse(req.body);
      const settlement = await riderService.collectCod(
        id,
        { id: req.user!.id, role: req.user!.role },
        input.amount,
        input.delivery_code
      );
      res.status(200).json({
        success: true,
        data: { settlement },
      });
    } catch (err) {
      next(err);
    }
  }

  async getMyDay(req: Request, res: Response, next: NextFunction) {
    try {
      const day = await riderService.getMyDay(req.user!.id);
      res.status(200).json({ success: true, data: day });
    } catch (err) {
      next(err);
    }
  }

  async getMyEarnings(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, data: await riderService.getMyEarnings(req.user!.id) });
    } catch (err) {
      next(err);
    }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = deliveryParamsSchema.parse(req.params);
      const input = updateLocationSchema.parse(req.body);
      const result = await riderLocationService.recordLocation(id, req.user!.id, input);
      res.status(202).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const riderController = new RiderController();

const ridersListQuerySchema = z.object({
  /** "true" also lists riders who can no longer deliver (the cash hand-in picker). */
  include_inactive: z.enum(['true', 'false']).optional(),
});

/**
 * Staff-facing: GET /admin/riders (ADMIN, OPERATIONS) for the manual
 * assignment picker - active riders only. `?include_inactive=true` lists
 * inactive riders too (each row carries `is_active`), for recording a cash
 * hand-in from a rider who has since been switched off.
 */
export async function listRidersForAssignment(req: Request, res: Response, next: NextFunction) {
  try {
    const { include_inactive } = ridersListQuerySchema.parse(req.query);
    const riders = await riderRepository.listActiveRidersForAssignment(undefined, {
      includeInactive: include_inactive === 'true',
    });
    res.status(200).json({ success: true, data: { riders } });
  } catch (err) {
    next(err);
  }
}

const suggestionsQuerySchema = z.object({ order_id: z.string().uuid('order_id must be a valid UUID') });

/** Staff-facing: GET /admin/riders/suggestions?order_id= (ADMIN, OPERATIONS), best rider first. */
export async function listRiderSuggestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { order_id } = suggestionsQuerySchema.parse(req.query);
    res.status(200).json({ success: true, data: await suggestRidersForOrder(order_id) });
  } catch (err) {
    next(err);
  }
}
