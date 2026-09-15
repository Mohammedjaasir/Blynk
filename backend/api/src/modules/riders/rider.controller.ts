import { Request, Response, NextFunction } from 'express';
import { riderService } from './rider.service.js';
import { DeliveryAssignmentStatus } from '../../database/types.js';

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
      const delivery = await riderService.getDeliveryById(req.params.id as string, req.user!.id);
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
      const { status, failure_reason } = req.body;
      const delivery = await riderService.updateDeliveryStatus(
        req.params.id as string,
        req.user!.id,
        status as DeliveryAssignmentStatus,
        failure_reason
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
      const { amount } = req.body;
      const settlement = await riderService.collectCod(
        req.params.id as string,
        req.user!.id,
        Number(amount)
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
