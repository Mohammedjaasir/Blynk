import { randomBytes } from 'node:crypto';
import { slugify } from './catalog.schema.js';

/** Six random base36 characters, e.g. "k3x9q2". */
export function randomSlugSuffix(): string {
  const n = randomBytes(5).readUIntBE(0, 5); // 40 bits, plenty for 6 base36 digits
  return n.toString(36).padStart(6, '0').slice(-6);
}

/**
 * A free slug for a new product or category whose slug was not given by the
 * client. Names in Sinhala or Tamil slugify to nothing, so an empty result
 * falls back to "<prefix>-<6 random base36>"; a taken slug gets -2, -3, ...
 * (then a random suffix) instead of a 409, so creating never fails on it.
 */
export async function generateUniqueSlug(
  name: string,
  prefix: 'product' | 'category',
  isTaken: (slug: string) => Promise<boolean>,
  maxLength = 128
): Promise<string> {
  // Room for a "-<suffix>" so the result never exceeds the column.
  let base = slugify(name).slice(0, maxLength - 8).replace(/-+$/, '');
  if (!base) base = `${prefix}-${randomSlugSuffix()}`;

  if (!(await isTaken(base))) return base;
  for (let n = 2; n <= 20; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  for (;;) {
    const candidate = `${base}-${randomSlugSuffix()}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}
