import { z } from 'zod';

/**
 * A rider's own reported position for one delivery (plan §5). Deliberately
 * carries no order_id/rider_id/customer_id/tracking status - those are all
 * derived server-side from the authenticated caller and the URL's delivery
 * id (plan §D.4), never trusted from the body.
 */
/** Meters. Well inside the column's NUMERIC(7,1) range (max 999999.9). */
export const MAX_ACCURACY_M = 100_000;

export const updateLocationSchema = z.object({
  latitude: z
    .number({ required_error: 'latitude is required', invalid_type_error: 'latitude must be a number' })
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z
    .number({ required_error: 'longitude is required', invalid_type_error: 'longitude must be a number' })
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  accuracy: z
    .number({ invalid_type_error: 'accuracy must be a number' })
    .min(0, 'accuracy must be zero or a positive number of meters')
    // deliveries.location_accuracy_m is NUMERIC(7,1): anything above 999999.9 is a Postgres numeric
    // overflow (a 500), and Infinity (`1e999` parses to it) is not storable at all. No real fix is
    // worse than tens of kilometres (an IP/cell-tower fallback), so 100 km is a generous ceiling.
    .max(MAX_ACCURACY_M, `accuracy must be at most ${MAX_ACCURACY_M} meters`)
    .nullable()
    .optional()
    // Some devices report 0 when they have no accuracy estimate: 0, null and
    // missing all mean "unknown" and are stored as NULL (the column allows it).
    .transform((v) => (v === undefined || v === null || v === 0 ? null : v)),
  captured_at: z
    .string({ required_error: 'captured_at is required' })
    .datetime({ message: 'captured_at must be an ISO 8601 timestamp' }),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
