import { Request, Response, NextFunction } from 'express';
import { staffService, type AuditMeta, type StaffActorRole } from './staff.service.js';
import type { CreateStaffInput, UpdateStaffInput } from './staff.schema.js';

const auditMeta = (req: Request): AuditMeta => ({
  actorId: req.user!.id,
  // The routes admit only ADMIN and OPERATIONS (index.ts).
  actorRole: req.user!.role as StaffActorRole,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

// Bodies and params are parsed by validate() on each route (see index.ts).
export class StaffController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.list(auditMeta(req));
      res.status(200).json({ success: true, data: { staff } });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.create(req.body as CreateStaffInput, auditMeta(req));
      res.status(201).json({ success: true, data: { staff } });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const staff = await staffService.update(req.params.id as string, req.body as UpdateStaffInput, auditMeta(req));
      res.status(200).json({ success: true, data: { staff } });
    } catch (err) {
      next(err);
    }
  }
}

export const staffController = new StaffController();
