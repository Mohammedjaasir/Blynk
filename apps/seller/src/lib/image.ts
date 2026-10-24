/**
 * Client-side image preparation. Sellers upload phone photos that can be
 * several megabytes; the API accepts up to 5 MB. Downscaling in the browser
 * keeps uploads small and quick on mobile data, and keeps the aspect ratio.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_EDGE = 1200;

export interface ImageValidationResult {
  ok: boolean;
  message?: string;
}

/** Checked before any work is done, so a bad pick fails instantly. */
export function validateImageFile(file: File): ImageValidationResult {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, message: 'Please choose a JPEG, PNG or WebP photo.' };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, message: 'That photo is too big. Please choose one under 25 MB.' };
  }
  return { ok: true };
}

/**
 * Returns a WebP copy no larger than MAX_EDGE on its longest side. Falls
 * back to the original file when the browser cannot encode (or when the file
 * is already small and within limits).
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= MAX_UPLOAD_BYTES) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.size === 0) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.webp`, { type: 'image/webp' });
  } catch {
    return file;
  }
}

export const TOO_LARGE_AFTER_RESIZE_MESSAGE =
  'This photo is still over 5 MB after shrinking it. Please choose a smaller one.';

/** Checked on the file actually sent, after prepareImageForUpload. */
export function validatePreparedFile(file: File): ImageValidationResult {
  return file.size > MAX_UPLOAD_BYTES ? { ok: false, message: TOO_LARGE_AFTER_RESIZE_MESSAGE } : { ok: true };
}
