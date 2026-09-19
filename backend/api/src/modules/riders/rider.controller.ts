import { Request, Response, NextFunction } from 'express';
import { riderService } from './rider.service.js';
import { riderRepository } from './rider.repository.js';
import { updateDeliveryStatusSchema, collectCodSchema, deliveryParamsSchema } from './rider.schema.js';

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
        req.user!.id,
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
        req.user!.id,
        input.amount
      );
      res.status(200).json({
        success: true,
        data: { settlement },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const riderController = new RiderController();

/** Staff-facing: GET /admin/riders (ADMIN) for the manual assignment picker. */
export async function listRidersForAssignment(_req: Request, res: Response, next: NextFunction) {
  try {
    const riders = await riderRepository.listActiveRidersForAssignment();
    res.status(200).json({ success: true, data: { riders } });
  } catch (err) {
    next(err);
  }
}
