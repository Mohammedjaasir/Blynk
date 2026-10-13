import { Platform } from 'react-native';

/**
 * Turns a product photo shot on a plain background into a transparent cut-out, so the
 * banner can float it in the UFO beam the way the reference does. Web only: the photo
 * is drawn to a canvas, the background colour is read off the border, and a flood fill
 * from the edges clears it with a soft edge. Photos without a plain background (a basket
 * on a table) resolve to null and are left out of the beam.
 */
const MAX_SIDE = 320;
const TOLERANCE = 34; // colour distance still counted as background
const FEATHER = 22; // extra distance that fades out instead of clearing
const cache = new Map<string, Promise<string | null>>();

export function cutout(uri: string): Promise<string | null> {
  let hit = cache.get(uri);
  if (!hit) {
    hit = make(uri).catch(() => null);
    cache.set(uri, hit);
  }
  return hit;
}

async function make(uri: string): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  img.src = uri;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const frame = ctx.getImageData(0, 0, w, h); // throws if the photo is cross-origin without CORS
  const px = frame.data;

  // Background = mean border colour; a busy border means there is no plain background.
  let r = 0, g = 0, b = 0, n = 0;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  for (const i of border) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; n++; }
  r /= n; g /= n; b /= n;
  const dist = (i: number) => Math.hypot(px[i * 4] - r, px[i * 4 + 1] - g, px[i * 4 + 2] - b);
  let plain = 0;
  for (const i of border) if (dist(i) < TOLERANCE) plain++;
  if (plain / border.length < 0.85) return null;

  // Flood fill the background from the border.
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const i of border) if (dist(i) < TOLERANCE + FEATHER) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    const d = dist(i);
    px[i * 4 + 3] = d < TOLERANCE ? 0 : Math.round((255 * (d - TOLERANCE)) / FEATHER);
    if (d >= TOLERANCE) continue; // feathered edge pixels do not spread the fill
    const x = i % w, y = (i - x) / w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) if (j >= 0 && !seen[j] && dist(j) < TOLERANCE + FEATHER) { seen[j] = 1; stack.push(j); }
  }

  // Trim to what is left; give up if almost nothing (or almost everything) survived.
  let x0 = w, y0 = h, x1 = -1, y1 = -1, kept = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 24) { kept++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const share = kept / (w * h);
  if (x1 < 0 || share < 0.04 || share > 0.97) return null;
  ctx.putImageData(frame, 0, 0);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
