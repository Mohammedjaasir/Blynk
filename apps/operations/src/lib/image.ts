/**
 * Client-side image preparation for Catalog (task F5). Ported from
 * `apps/admin/src/lib/image.ts` (a fresh implementation, not an import -
 * common.md rule 2) - identical behaviour, since the backend limit
 * (`MAX_IMAGE_BYTES`, `backend/api/src/utils/storage.ts`) is the same one
 * every Blynk client uploads against.
 *
 * Operators upload phone photos that can be several megabytes; the API caps
 * a file at 2 MB. Downscaling in the browser keeps uploads small, preserves
 * aspect ratio, and means the backend never has to depend on a native image
 * library.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_EDGE = 1200;

export interface ImageValidationResult {
  ok: boolean;
  message?: string;
}

/** Checked before any work is done, so a bad pick fails instantly. */
export function validateImageFile(file: File): ImageValidationResult {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, message: 'Use a JPEG, PNG or WebP image.' };
  }
  // 12 MB of original is plenty to downscale from; beyond that it is
  // usually a mistake (a screenshot burst, a RAW export).
  if (file.size > 12 * 1024 * 1024) {
    return { ok: false, message: 'That image is too large. Use one under 12 MB.' };
  }
  return { ok: true };
}

/**
 * Returns a WebP copy no larger than MAX_EDGE on its longest side. Falls
 * back to the original file when the browser can't encode (or when the file
 * is already small and within limits).
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const alreadySmallEnough = scale === 1 && file.size <= MAX_UPLOAD_BYTES;
    if (alreadySmallEnough) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.size === 0) return file;

    const name = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${name}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}

/**
 * The stored files a successful save left behind: each image the record had
 * before (`before`) that it no longer uses (`after`). The uploader never
 * deletes on Remove/Replace any more - the record still points at the old
 * file until the form is saved, and a cancelled or failed save must leave it
 * intact - so the form calls this only after its save succeeded.
 */
export function replacedImages(before: (string | null | undefined)[], after: (string | null | undefined)[]): string[] {
  const kept = new Set(after.filter(Boolean));
  return [...new Set(before.filter((url): url is string => Boolean(url) && !kept.has(url)))];
}
