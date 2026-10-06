import { AppError } from '../../middleware/error.middleware.js';
import { mediaStorage } from '../../utils/storage.js';
import { promotionRepository } from './promotion.repository.js';
import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type {
  CreatePromotionInput,
  ReorderPromotionsInput,
  UpdatePromotionInput,
} from './promotion.schema.js';

/**
 * Whether any product, category or promotion (live or soft-deleted, which
 * can be restored) still references this media file - by the exact URL or
 * by any URL ending in the same storage key (the host part can differ).
 */
export async function mediaUrlInUse(url: string, key: string): Promise<boolean> {
  const suffix = `%/${key.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
  const matches = (col: string) => sql`(${sql.ref(col)} = ${url} OR ${sql.ref(col)} LIKE ${suffix})`;
  const row = await sql<{ used: boolean }>`
    SELECT EXISTS (SELECT 1 FROM products WHERE ${matches('image_url')})
        OR EXISTS (SELECT 1 FROM categories WHERE ${matches('image_url')})
        OR EXISTS (SELECT 1 FROM promotions WHERE ${matches('image_url')} OR ${matches('background_image_url')}) AS used
  `.execute(db);
  return Boolean(row.rows[0]?.used);
}

/** What the customer app receives - no internal bookkeeping fields. */
export interface CustomerPromotionDto {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  background_type: string;
  background_color: string | null;
  background_color_end: string | null;
  background_image_url: string | null;
  /**
   * Where the card's `cover` crop anchors on the background image
   * (migration 009), as a percentage of that image's own width and height.
   * Always present and always 0-100; 50/50 is the centre, i.e. the crop the
   * app already did before the field existed.
   */
  background_focal_x: number;
  background_focal_y: number;
  cta_label: string | null;
  cta_destination_type: string | null;
  cta_destination_value: string | null;
  display_order: number;
}

/**
 * Normalises a stored focal percentage into the 0-100 the API promises. The
 * column is `SMALLINT NOT NULL DEFAULT 50` with a `BETWEEN 0 AND 100` CHECK,
 * so the fallback only matters for a database where migration 009 has not run
 * yet - and 50 is exactly the centre crop that database's app already does.
 */
function clampFocal(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export class PromotionService {
  async listActive(): Promise<CustomerPromotionDto[]> {
    const rows = await promotionRepository.findActive();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      image_url: row.image_url,
      background_type: row.background_type,
      background_color: row.background_color,
      background_color_end: row.background_color_end,
      background_image_url: row.background_image_url,
      background_focal_x: clampFocal(row.background_focal_x),
      background_focal_y: clampFocal(row.background_focal_y),
      cta_label: row.cta_label,
      cta_destination_type: row.cta_destination_type,
      cta_destination_value: row.cta_destination_value,
      display_order: row.display_order,
    }));
  }

  async listAdmin(isActive?: boolean) {
    return await promotionRepository.findAll(isActive);
  }

  async getById(id: string) {
    const promotion = await promotionRepository.findById(id);
    if (!promotion) {
      throw new AppError('Promotion not found.', 404, 'PROMOTION_NOT_FOUND');
    }
    return promotion;
  }

  async create(input: CreatePromotionInput) {
    return await promotionRepository.create(input);
  }

  async update(id: string, input: UpdatePromotionInput) {
    const existing = await this.getById(id);

    // Background rules, applied to the merged row so a partial update can't
    // leave a gradient with one colour or an image background with no image.
    const backgroundType = input.background_type ?? existing.background_type;
    const colorStart =
      input.background_color !== undefined
        ? input.background_color
        : existing.background_color;
    const colorEnd =
      input.background_color_end !== undefined
        ? input.background_color_end
        : existing.background_color_end;
    const backgroundImage =
      input.background_image_url !== undefined
        ? input.background_image_url
        : existing.background_image_url;

    if (backgroundType === 'GRADIENT' && !(colorStart && colorEnd)) {
      throw new AppError(
        'A gradient background needs both colours',
        400,
        'VALIDATION_ERROR'
      );
    }
    // ARTWORK (a finished banner, drawn full-bleed) needs its file for the
    // same reason IMAGE does - it IS the card.
    if ((backgroundType === 'IMAGE' || backgroundType === 'ARTWORK') && !backgroundImage) {
      throw new AppError(
        backgroundType === 'ARTWORK'
          ? 'A full-artwork background needs background_image_url'
          : 'An image background needs background_image_url',
        400,
        'VALIDATION_ERROR'
      );
    }

    // The create schema's cross-field rule, applied to the merged result so
    // a partial update can't leave a destination without its value/label.
    const type =
      input.cta_destination_type !== undefined
        ? input.cta_destination_type
        : existing.cta_destination_type;
    const value =
      input.cta_destination_value !== undefined
        ? input.cta_destination_value
        : existing.cta_destination_value;
    const label =
      input.cta_label !== undefined ? input.cta_label : existing.cta_label;

    if ((type === 'CATEGORY' || type === 'PRODUCT') && !value) {
      throw new AppError(
        `cta_destination_value is required when cta_destination_type is ${type}`,
        400,
        'VALIDATION_ERROR'
      );
    }
    // Mirrors the create schema: ARTWORK may point somewhere without a button
    // label - the banner carries its own call to action and the whole card
    // becomes the tap target.
    if (type && !label && backgroundType !== 'ARTWORK') {
      throw new AppError(
        'cta_label is required when the promotion has a destination',
        400,
        'VALIDATION_ERROR'
      );
    }

    // Replacing or clearing the image removes the file it used to point at,
    // so local storage doesn't fill with orphans - but only after the update
    // succeeded, and only if nothing else still shows that file.
    const replaced: string[] = [];
    if (input.image_url !== undefined && existing.image_url && input.image_url !== existing.image_url) {
      replaced.push(existing.image_url);
    }
    if (
      input.background_image_url !== undefined &&
      existing.background_image_url &&
      input.background_image_url !== existing.background_image_url
    ) {
      replaced.push(existing.background_image_url);
    }

    const updated = await promotionRepository.update(id, input);
    if (!updated) {
      throw new AppError('Promotion not found.', 404, 'PROMOTION_NOT_FOUND');
    }
    for (const url of replaced) await this.deleteImageFileIfUnused(url);
    return updated;
  }

  async reorder(input: ReorderPromotionsInput) {
    await promotionRepository.reorder(input.items);
    return await promotionRepository.findAll();
  }

  async remove(id: string) {
    const deleted = await promotionRepository.remove(id);
    if (!deleted) {
      throw new AppError('Promotion not found.', 404, 'PROMOTION_NOT_FOUND');
    }
    if (deleted.image_url) {
      await this.deleteImageFileIfUnused(deleted.image_url);
    }
    if (deleted.background_image_url) {
      await this.deleteImageFileIfUnused(deleted.background_image_url);
    }
    return deleted;
  }

  /**
   * Deletes a media file no product, category or promotion row points at any
   * more (the same upload can be reused - e.g. a product photo used as a
   * promotion image). Best effort: a missing file must never fail the write
   * that triggered it.
   */
  private async deleteImageFileIfUnused(url: string) {
    const key = mediaStorage.keyFromUrl(url);
    if (!key) return;
    try {
      if (await mediaUrlInUse(url, key)) return;
      await mediaStorage.delete(key);
    } catch {
      // Ignored deliberately - orphaned media is not worth a failed request.
    }
  }
}

export const promotionService = new PromotionService();
