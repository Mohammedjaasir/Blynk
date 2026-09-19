import { db } from '../../database/connection.js';
import type { CreatePromotionInput, UpdatePromotionInput } from './promotion.schema.js';

export class PromotionRepository {
  /** What the customer Home carousel reads: active only, in display order. */
  async findActive() {
    return await db
      .selectFrom('promotions')
      .select([
        'id',
        'title',
        'subtitle',
        'image_url',
        'background_type',
        'background_color',
        'background_color_end',
        'background_image_url',
        'cta_label',
        'cta_destination_type',
        'cta_destination_value',
        'display_order',
      ])
      .where('is_active', '=', true)
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc')
      .execute();
  }

  /** Admin listing: everything, optionally filtered by active state. */
  async findAll(isActive?: boolean) {
    let query = db
      .selectFrom('promotions')
      .selectAll()
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'asc');

    if (isActive !== undefined) {
      query = query.where('is_active', '=', isActive);
    }

    return await query.execute();
  }

  async findById(id: string) {
    return await db
      .selectFrom('promotions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async create(input: CreatePromotionInput) {
    return await db
      .insertInto('promotions')
      .values({
        title: input.title,
        subtitle: input.subtitle ?? null,
        image_url: input.image_url ?? null,
        background_type: input.background_type ?? 'SOLID',
        background_color: input.background_color ?? null,
        background_color_end: input.background_color_end ?? null,
        background_image_url: input.background_image_url ?? null,
        cta_label: input.cta_label ?? null,
        cta_destination_type: input.cta_destination_type ?? null,
        cta_destination_value: input.cta_destination_value ?? null,
        display_order: input.display_order ?? 0,
        is_active: input.is_active ?? true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(id: string, input: UpdatePromotionInput) {
    return await db
      .updateTable('promotions')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
        ...(input.image_url !== undefined ? { image_url: input.image_url } : {}),
        ...(input.background_type !== undefined
          ? { background_type: input.background_type }
          : {}),
        ...(input.background_color !== undefined
          ? { background_color: input.background_color }
          : {}),
        ...(input.background_color_end !== undefined
          ? { background_color_end: input.background_color_end }
          : {}),
        ...(input.background_image_url !== undefined
          ? { background_image_url: input.background_image_url }
          : {}),
        ...(input.cta_label !== undefined ? { cta_label: input.cta_label } : {}),
        ...(input.cta_destination_type !== undefined
          ? { cta_destination_type: input.cta_destination_type }
          : {}),
        ...(input.cta_destination_value !== undefined
          ? { cta_destination_value: input.cta_destination_value }
          : {}),
        ...(input.display_order !== undefined
          ? { display_order: input.display_order }
          : {}),
        ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
        // This schema has no updated_at triggers; set it explicitly.
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  /** Display order is the only thing reorder touches, in one transaction. */
  async reorder(items: { id: string; display_order: number }[]) {
    await db.transaction().execute(async (trx) => {
      for (const item of items) {
        await trx
          .updateTable('promotions')
          .set({ display_order: item.display_order, updated_at: new Date() })
          .where('id', '=', item.id)
          .execute();
      }
    });
  }

  async remove(id: string) {
    const deleted = await db
      .deleteFrom('promotions')
      .where('id', '=', id)
      // Both uploaded files are removed with the promotion.
      .returning(['id', 'image_url', 'background_image_url'])
      .executeTakeFirst();
    return deleted;
  }
}

export const promotionRepository = new PromotionRepository();
