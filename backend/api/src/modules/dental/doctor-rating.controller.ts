import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware.js';
import { appointmentIdParamSchema } from './appointment.schema.js';
import { doctorIdParamSchema } from './dental.schema.js';
import {
  doctorRatingService,
  doctorRatingsQuerySchema,
  rateAppointmentSchema,
  ratingHiddenSchema,
  ratingIdParamSchema,
} from './doctor-rating.service.js';

function actorId(req: Request): string {
  if (!req.user) throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
  return req.user.id;
}

/** Doctor ratings (migration 023): the customer's rating and staff moderation. */
export class DoctorRatingController {
  /** POST /dental/appointments/:id/rating */
  async rate(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = appointmentIdParamSchema.parse(req.params);
      const input = rateAppointmentSchema.parse(req.body ?? {});
      const result = await doctorRatingService.rateAppointment(actorId(req), id, input);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  /** GET /admin/dental/doctors/:id/ratings */
  async listForDoctor(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = doctorIdParamSchema.parse(req.params);
      const query = doctorRatingsQuerySchema.parse(req.query);
      const result = await doctorRatingService.listDoctorRatings(id, query);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  /** PATCH /admin/dental/ratings/:id/hidden */
  async setHidden(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = ratingIdParamSchema.parse(req.params);
      const { hidden } = ratingHiddenSchema.parse(req.body ?? {});
      const rating = await doctorRatingService.setHidden(actorId(req), id, hidden);
      res.status(200).json({ success: true, data: { rating } });
    } catch (err) {
      next(err);
    }
  }
}

export const doctorRatingController = new DoctorRatingController();
