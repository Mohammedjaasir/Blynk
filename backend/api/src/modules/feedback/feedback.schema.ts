import { z } from 'zod';

/**
 * Customer feedback (migration 013). The customer app sends a message, a
 * category and optionally a 1-5 star rating; Blynk Admin reads them and
 * marks them read. Limits mirror the table's CHECK constraints so a bad
 * request is a 400 here, never a database error.
 */
export const feedbackCategories = ['APP', 'DELIVERY', 'PRODUCTS', 'OTHER'] as const;
export const feedbackStatuses = ['NEW', 'READ'] as const;

export const FEEDBACK_MESSAGE_MAX = 2000;

export const createFeedbackSchema = z.object({
  rating: z
    .number()
    .int('Rating must be a whole number of stars')
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5')
    .nullable()
    .optional(),
  category: z.enum(feedbackCategories, {
    errorMap: () => ({ message: 'Category must be one of APP, DELIVERY, PRODUCTS, OTHER' }),
  }),
  message: z
    .string({ required_error: 'Message is required' })
    .trim()
    .min(1, 'Message is required')
    .max(FEEDBACK_MESSAGE_MAX, `Message must be at most ${FEEDBACK_MESSAGE_MAX} characters`),
});

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

/** Admin list: newest first, optional status filter, paged like admin orders. */
export const adminFeedbackQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1).default(1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .pipe(z.number().int().min(1).max(100).default(50)),
  status: z.enum(feedbackStatuses).optional(),
});

export type AdminFeedbackQueryInput = z.infer<typeof adminFeedbackQuerySchema>;

export const feedbackIdParamsSchema = z.object({
  id: z.string().uuid('Feedback id must be a valid UUID'),
});

export const updateFeedbackStatusSchema = z.object({
  status: z.enum(feedbackStatuses, {
    errorMap: () => ({ message: 'Status must be NEW or READ' }),
  }),
});

export type UpdateFeedbackStatusInput = z.infer<typeof updateFeedbackStatusSchema>;
