import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { AppError } from '../../middleware/error.middleware.js';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  mediaStorage,
} from '../../utils/storage.js';

/**
 * Admin image upload. Files are held in memory (they're capped at 2 MB),
 * validated, then handed to the storage abstraction; only the resulting URL
 * is ever written to the database.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      callback(
        new AppError(
          'Unsupported image type. Use JPEG, PNG or WebP.',
          400,
          'UNSUPPORTED_MEDIA_TYPE'
        )
      );
      return;
    }
    callback(null, true);
  },
});

/** Only these folders can be written to - the value is never free text. */
const ALLOWED_FOLDERS = ['products', 'promotions'] as const;
type MediaFolder = (typeof ALLOWED_FOLDERS)[number];

export class MediaController {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError('No image file was uploaded.', 400, 'NO_FILE');
      }

      const requested = String(req.body?.folder ?? 'products');
      if (!ALLOWED_FOLDERS.includes(requested as MediaFolder)) {
        throw new AppError(
          `folder must be one of: ${ALLOWED_FOLDERS.join(', ')}`,
          400,
          'VALIDATION_ERROR'
        );
      }

      // The declared content type is attacker-controlled, so the file's own
      // magic number decides: anything unrecognisable is refused outright.
      const contentType = detectImageType(file.buffer);
      if (!contentType || !ALLOWED_IMAGE_TYPES[contentType]) {
        throw new AppError(
          'Unsupported image type. Use JPEG, PNG or WebP.',
          400,
          'UNSUPPORTED_MEDIA_TYPE'
        );
      }

      const stored = await mediaStorage.save(file.buffer, contentType, requested);
      res.status(201).json({ success: true, data: { media: stored } });
    } catch (err) {
      next(err);
    }
  }

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const url = String(req.body?.url ?? '');
      const key = mediaStorage.keyFromUrl(url);
      if (!key) {
        throw new AppError('url must be a Blynk media URL.', 400, 'VALIDATION_ERROR');
      }
      await mediaStorage.delete(key);
      res.status(200).json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  }
}

/** Magic-number sniffing for the three formats we accept. */
function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export const mediaController = new MediaController();
