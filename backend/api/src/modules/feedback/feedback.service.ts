import { feedbackRepository } from './feedback.repository.js';
import type {
  AdminFeedbackQueryInput,
  CreateFeedbackInput,
  UpdateFeedbackStatusInput,
} from './feedback.schema.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * At most this many messages per customer per rolling hour. Counted from the
 * table rather than in memory, so a restart or a second API instance does not
 * reset it.
 */
export const FEEDBACK_HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;

export class FeedbackService {
  async create(userId: string, input: CreateFeedbackInput) {
    const recent = await feedbackRepository.countByUserSince(userId, new Date(Date.now() - HOUR_MS));
    if (recent >= FEEDBACK_HOURLY_LIMIT) {
      throw new AppError(
        'You have already sent 5 messages in the last hour. Please try again later.',
        429,
        'FEEDBACK_RATE_LIMITED',
        { limit: FEEDBACK_HOURLY_LIMIT, window_minutes: 60 }
      );
    }
    return await feedbackRepository.create(userId, input);
  }

  async listAdmin(query: AdminFeedbackQueryInput) {
    const { page, limit, status } = query;
    const { items, total } = await feedbackRepository.findPage(page, limit, status);
    return {
      feedback: items,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async updateStatus(id: string, input: UpdateFeedbackStatusInput) {
    const updated = await feedbackRepository.updateStatus(id, input.status);
    if (!updated) {
      throw new AppError('Feedback not found.', 404, 'FEEDBACK_NOT_FOUND');
    }
    return updated;
  }
}

export const feedbackService = new FeedbackService();
