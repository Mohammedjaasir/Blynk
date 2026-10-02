import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { deviceTokenRepository } from './push.repository.js';

const registerDeviceSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  platform: z.enum(['android', 'ios', 'web']),
});

/** POST /me/devices and DELETE /me/devices/:token - any signed-in user. */
export const devicesController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const input = registerDeviceSchema.parse(req.body);
      const device = await deviceTokenRepository.upsert(req.user!.id, input.token, input.platform);
      res.status(200).json({ success: true, data: { device } });
    } catch (err) {
      next(err);
    }
  },

  async unregister(req: Request, res: Response, next: NextFunction) {
    try {
      const removed = await deviceTokenRepository.removeForUser(req.user!.id, String(req.params.token ?? ''));
      res.status(200).json({ success: true, data: { removed } });
    } catch (err) {
      next(err);
    }
  },
};
