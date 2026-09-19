import { z } from 'zod';

/** Delivery id in the URL: malformed ids are a 400, never a database error. */
export const deliveryParamsSchema = z.object({ id: z.string().uuid('Invalid delivery ID') });

/**
 * Delivery statuses a rider may request (architecture §5 rider API, §G).
 * DELIVERED is not here: completion happens only through collect-cod, so the
 * delivery, payment and order can never disagree. ASSIGNED is set by the
 * assignment itself, and ACCEPTED/REJECTED have no documented rider flow yet.
 * Whether the requested status is reachable from the current one is decided
 * in the repository, under the row locks.
 */
export const updateDeliveryStatusSchema = z
  .object({
    status: z.enum(['PICKED_UP', 'ARRIVED_AT_CUSTOMER', 'FAILED'], {
      invalid_type_error: 'Invalid delivery status value',
    }),
    failure_reason: z
      .string()
      .trim()
      .min(1, 'Failure reason cannot be empty')
      .max(500, 'Failure reason cannot exceed 500 characters')
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'FAILED' && !value.failure_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['failure_reason'],
        message: 'A reason is required when a delivery fails',
      });
    }
  });

export type RiderDeliveryStatus = z.infer<typeof updateDeliveryStatusSchema>['status'];

export type UpdateDeliveryStatusInput = z.infer<typeof updateDeliveryStatusSchema>;

/**
 * Validates COD cash collection input.
 * Amount must be a non-negative finite number (max 1,000,000 LKR).
 */
export const collectCodSchema = z.object({
  amount: z
    .number({
      required_error: 'amount is required',
      invalid_type_error: 'amount must be a number',
    })
    .nonnegative('amount cannot be negative')
    .finite('amount must be a finite number')
    .max(1_000_000, 'amount exceeds maximum allowed value'),
});

export type CollectCodInput = z.infer<typeof collectCodSchema>;
