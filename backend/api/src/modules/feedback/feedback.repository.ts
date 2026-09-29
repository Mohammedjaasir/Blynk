import { db } from '../../database/connection.js';
import type { FeedbackStatus } from '../../database/types.js';
import type { CreateFeedbackInput } from './feedback.schema.js';

export class FeedbackRepository {
  async create(userId: string, input: CreateFeedbackInput) {
    return await db
      .insertInto('customer_feedback')
      .values({
        user_id: userId,
        rating: input.rating ?? null,
        category: input.category,
        message: input.message,
      })
      .returning(['id', 'rating', 'category', 'message', 'status', 'created_at'])
      .executeTakeFirstOrThrow();
  }

  /** How many messages this customer sent since `since` - the hourly limit. */
  async countByUserSince(userId: string, since: Date): Promise<number> {
    const row = await db
      .selectFrom('customer_feedback')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('user_id', '=', userId)
      .where('created_at', '>=', since)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  /** Admin list, newest first, with who sent it. */
  async findPage(page: number, limit: number, status?: FeedbackStatus) {
    let query = db
      .selectFrom('customer_feedback as f')
      .innerJoin('users as u', 'u.id', 'f.user_id')
      .select([
        'f.id',
        'f.rating',
        'f.category',
        'f.message',
        'f.status',
        'f.created_at',
        'f.user_id',
        'u.full_name',
        'u.phone',
      ])
      .orderBy('f.created_at', 'desc')
      .orderBy('f.id', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    let countQuery = db
      .selectFrom('customer_feedback')
      .select((eb) => eb.fn.countAll<string>().as('count'));

    if (status) {
      query = query.where('f.status', '=', status);
      countQuery = countQuery.where('status', '=', status);
    }

    const [items, countRow] = await Promise.all([query.execute(), countQuery.executeTakeFirst()]);
    return { items, total: Number(countRow?.count ?? 0) };
  }

  async updateStatus(id: string, status: FeedbackStatus) {
    return await db
      .updateTable('customer_feedback')
      .set({ status })
      .where('id', '=', id)
      .returning(['id', 'status'])
      .executeTakeFirst();
  }
}

export const feedbackRepository = new FeedbackRepository();
