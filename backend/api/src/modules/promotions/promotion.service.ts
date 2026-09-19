import { AppError } from '../../middleware/error.middleware.js';
import { mediaStorage } from '../../utils/storage.js';
import { promotionRepository } from './promotion.repository.js';
import type {
  CreatePromotionInput,
  ReorderPromotionsInput,
  UpdatePromotionInput,
} from './promotion.schema.js';

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
  cta_label: string | null;
  cta_destination_type: string | null;
  cta_destination_value: string | null;
  display_order: number;
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
    if (backgroundType === 'IMAGE' && !backgroundImage) {
      throw new AppError(
        'An image background needs background_image_url',
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
    if (type && !label) {
      throw new AppError(
        'cta_label is required when the promotion has a destination',
        400,
        'VALIDATION_ERROR'
      );
    }

    // Replacing or clearing the image removes the file it used to point at,
    // so local storage doesn't fill with orphans.
    if (input.image_url !== undefined && existing.image_url && input.image_url !== existing.image_url) {
      await this.deleteImageFile(existing.image_url);
    }
    if (
      input.background_image_url !== undefined &&
      existing.background_image_url &&
      input.background_image_url !== existing.background_image_url
    ) {
      await this.deleteImageFile(existing.background_image_url);
    }

    const updated = await promotionRepository.update(id, input);
    if (!updated) {
      throw new AppError('Promotion not found.', 404, 'PROMOTION_NOT_FOUND');
    }
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
      await this.deleteImageFile(deleted.image_url);
    }
    if (deleted.background_image_url) {
      await this.deleteImageFile(deleted.background_image_url);
    }
    return deleted;
  }

  /** Best effort: a missing file must never fail the write that triggered it. */
  private async deleteImageFile(url: string) {
    const key = mediaStorage.keyFromUrl(url);
    if (!key) return;
    try {
      await mediaStorage.delete(key);
    } catch {
      // Ignored deliberately - orphaned media is not worth a failed request.
    }
  }
}

export const promotionService = new PromotionService();
