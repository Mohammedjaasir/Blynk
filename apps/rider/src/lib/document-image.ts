import { MAX_DOCUMENT_BYTES } from '../api/applicant';

/**
 * Getting a document photo ready to upload (owner, 2026-10-10).
 *
 * Phone photos are large and carry metadata (including where the photo was
 * taken). Re-drawing the photo on a canvas and saving it as a JPEG makes it
 * smaller and drops all of that metadata; the browser applies the photo's
 * rotation while drawing, so it stays upright. The API removes location
 * metadata again on its side, as a backstop.
 *
 * A PDF is sent as it is (up to 8 MB). HEIC photos (some phones' default)
 * can't be read by every WebView: they are re-drawn when the WebView can,
 * and refused with a clear message when it can't.
 */
const MAX_EDGE = 2200;
const QUALITY = 0.85;
/** Originals beyond this are almost certainly not a document photo. */
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

export class DocumentFileError extends Error {}

export const isPdf = (file: { type: string; name?: string }) =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
const isHeic = (file: { type: string; name?: string }) =>
  /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name ?? '');
const DIRECT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function prepareDocumentFile(file: File): Promise<{ blob: Blob; name: string; isPdf: boolean }> {
  if (isPdf(file)) {
    if (file.size > MAX_DOCUMENT_BYTES) throw new DocumentFileError('That PDF is larger than 8 MB. Take a photo of the document instead.');
    return { blob: file, name: file.name || 'document.pdf', isPdf: true };
  }
  if (!file.type.startsWith('image/') && !isHeic(file)) {
    throw new DocumentFileError('Use a photo or a PDF of the document.');
  }
  if (file.size > MAX_ORIGINAL_BYTES) throw new DocumentFileError('That photo is too large. Take it again with the camera button.');

  const reencoded = await reencode(file);
  if (reencoded) {
    if (reencoded.size > MAX_DOCUMENT_BYTES) throw new DocumentFileError('That photo is still larger than 8 MB. Take it again.');
    return { blob: reencoded, name: 'document.jpg', isPdf: false };
  }
  if (isHeic(file)) {
    throw new DocumentFileError("This phone saved the photo as HEIC, which can't be uploaded. Use the Take photo button instead.");
  }
  if (DIRECT_IMAGE_TYPES.includes(file.type) && file.size <= MAX_DOCUMENT_BYTES) {
    return { blob: file, name: file.name || 'document.jpg', isPdf: false };
  }
  throw new DocumentFileError("This photo can't be read. Take it again with the camera button.");
}

async function reencode(file: File): Promise<Blob | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
