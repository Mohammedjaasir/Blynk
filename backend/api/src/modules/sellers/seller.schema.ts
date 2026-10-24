import { z } from 'zod';
import { mediaStorage } from '../../utils/storage.js';
import { LOCATION_NOTE_MAX, SRI_LANKA_BOUNDS } from './seller.location.js';

/** Largest price a seller may ask, LKR (plan: seller_price > 0 and <= 1,000,000). */
export const MAX_SELLER_PRICE = 1_000_000;

/** An optional text field: blank counts as "none" (null), so a form can clear it. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const uuid = (what: string) => z.string({ required_error: `${what} is required.` }).uuid(`${what} must be a valid id.`);

/** A map coordinate inside Sri Lanka (seller.location.ts); null clears. */
const coordinate = (what: 'Latitude' | 'Longitude', min: number, max: number) =>
  z
    .number({ invalid_type_error: `${what} must be a number.` })
    .finite(`${what} must be a number.`)
    .min(min, 'Pin a place in Sri Lanka.')
    .max(max, 'Pin a place in Sri Lanka.')
    .nullable()
    .optional();

export const profileSchema = z
  .object({
    shop_name: z
      .string({ required_error: 'Shop name is required.' })
      .trim()
      .min(2, 'Shop name must be at least 2 characters.')
      .max(80, 'Shop name must be at most 80 characters.'),
    contact_name: optionalText(80),
    address: optionalText(255),
    note: optionalText(500),
    // Migration 053: the shop pin (waits for Admin) and how to find the shop.
    latitude: coordinate('Latitude', SRI_LANKA_BOUNDS.minLat, SRI_LANKA_BOUNDS.maxLat),
    longitude: coordinate('Longitude', SRI_LANKA_BOUNDS.minLng, SRI_LANKA_BOUNDS.maxLng),
    location_note: optionalText(LOCATION_NOTE_MAX),
  })
  .superRefine((v, ctx) => {
    // Both or neither: a pin is one point, and clearing clears both.
    const latSent = v.latitude !== undefined;
    const lngSent = v.longitude !== undefined;
    if (latSent !== lngSent || (latSent && (v.latitude === null) !== (v.longitude === null))) {
      const missing = !latSent ? 'latitude' : !lngSent ? 'longitude' : v.latitude === null ? 'latitude' : 'longitude';
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [missing], message: 'Send the latitude and the longitude together.' });
    }
  });
export type ProfileInput = z.infer<typeof profileSchema>;

const sellerPrice = z
  .number({ required_error: 'Your price is required.', invalid_type_error: 'Your price must be a number.' })
  .gt(0, 'Your price must be more than 0.')
  .max(MAX_SELLER_PRICE, `Your price must be at most ${MAX_SELLER_PRICE.toLocaleString('en-US')}.`)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Your price can have at most 2 decimals.');

/** Photos are only ever Blynk's own uploads (POST /seller/uploads/image). */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => mediaStorage.keyFromUrl(u) !== null, 'Upload the photo with the image uploader.')
  .nullable()
  .optional();

const productFields = {
  name: z.string({ required_error: 'Name is required.' }).trim().min(2, 'Name must be at least 2 characters.').max(120),
  category_id: uuid('Category'),
  unit: z.string({ required_error: 'Unit is required.' }).trim().min(1, 'Unit is required.').max(32),
  pack_size: optionalText(64),
  description: optionalText(2000),
  image_url: z.preprocess((v) => (v === '' ? null : v), imageUrl),
  barcode: optionalText(64),
  seller_price: sellerPrice,
};

export const createProductSchema = z.object(productFields);
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const editProductSchema = z
  .object(productFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Send at least one field to change.' });
export type EditProductInput = z.infer<typeof editProductSchema>;

export const idParamSchema = z.object({ id: z.string().uuid('Invalid id.') });

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Not a real date.');

export const statementQuerySchema = z
  .object({ from: day.optional(), to: day.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must not be after "to".', path: ['from'] });
