/**
 * Pure template renderers and payload sanitization for Blynk customer notifications.
 *
 * CRITICAL SECURITY INVARIANT:
 * Zero exposure of wholesale costs, markups, user UUIDs, passwords, OTP hashes,
 * or staff notes. Only customer-facing order numbers and retail LKR totals are rendered.
 */

export interface OrderPlacedPayload {
  order_number: string;
  total_amount: number | string;
  scheduled_for?: string | null;
}

export interface OrderCancelledPayload {
  order_number: string;
  reason?: string | null;
}

export interface ItemUnavailablePayload {
  order_number: string;
  item_name: string;
  new_total_amount: number | string;
}

export interface RiderAssignedPayload {
  order_number: string;
  rider_name?: string;
  vehicle_registration_number?: string;
}

export interface OutForDeliveryPayload {
  order_number: string;
  total_amount: number | string;
}

export interface DeliveredPayload {
  order_number: string;
}

export interface CodPaymentConfirmedPayload {
  order_number: string;
  amount: number | string;
}

/** Dental (B5): confirmation/cancellation. The day-before reminder
 * (migration 023) carries its own title/body: DENTAL_APPOINTMENT_REMINDER. */
export interface DentalAppointmentConfirmedPayload {
  clinic_name: string;
  doctor_name: string;
  start_at: string;
  consultation_fee_snapshot: number | string | null;
}

export interface DentalAppointmentCancelledPayload {
  clinic_name: string;
  doctor_name: string;
  start_at: string;
  cancelled_by: 'customer' | 'clinic';
  reason?: string | null;
}

/** Clinic-local (Asia/Colombo) "12 Jan 2026 at 10:30 AM" for a dental SMS -
 * same explicit-options `toLocaleString` pattern ORDER_PLACED already uses
 * for its own scheduled-time rendering, just with the date part added. */
function formatClinicDateTime(iso: string): string {
  const when = new Date(iso);
  const datePart = when.toLocaleDateString('en-US', {
    timeZone: 'Asia/Colombo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timePart = when.toLocaleString('en-US', {
    timeZone: 'Asia/Colombo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart} at ${timePart}`;
}

export class NotificationTemplates {
  static render(notificationType: string, payload: unknown): string {
    const data = (payload as Record<string, unknown>) || {};
    const orderNumber = (data.order_number as string) || 'Your order';

    switch (notificationType) {
      case 'ORDER_PLACED': {
        const total = Number(data.total_amount || 0).toFixed(2);
        if (data.scheduled_for) {
          const scheduledTime = new Date(data.scheduled_for as string).toLocaleString('en-US', {
            timeZone: 'Asia/Colombo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          return `Blynk: Order #${orderNumber} placed for LKR ${total}. Delivery is scheduled for 8:00 AM - 9:00 PM operating hours (${scheduledTime}).`;
        }
        return `Blynk: Order #${orderNumber} has been placed successfully! Total: LKR ${total}. Sourcing and packing are in progress.`;
      }

      case 'ORDER_CANCELLED': {
        const reason = (data.reason as string) || 'Cancelled per customer request';
        return `Blynk: Order #${orderNumber} has been cancelled (${reason}). If you did not make this request, please contact support.`;
      }

      case 'ITEM_UNAVAILABLE': {
        const itemName = (data.item_name as string) || 'An item';
        const newTotal = Number(data.new_total_amount || 0).toFixed(2);
        return `Blynk: Update on order #${orderNumber} - ${itemName} was unavailable and has been removed. Updated COD total: LKR ${newTotal}.`;
      }

      case 'RIDER_ASSIGNED': {
        const riderName = (data.rider_name as string) || 'A delivery rider';
        const vehicle = data.vehicle_registration_number ? ` (${data.vehicle_registration_number})` : '';
        return `Blynk: ${riderName}${vehicle} has been assigned to deliver your order #${orderNumber}.`;
      }

      case 'OUT_FOR_DELIVERY': {
        const total = Number(data.total_amount || 0).toFixed(2);
        // One plain-text part: about 100 characters with the code.
        const code = typeof data.delivery_code === 'string' ? data.delivery_code : null;
        return code
          ? `Blynk: Order #${orderNumber} is on the way. Delivery code: ${code}, show it to the rider. Keep LKR ${total} ready.`
          : `Blynk: Order #${orderNumber} is on the way. Keep LKR ${total} ready.`;
      }

      case 'DELIVERED': {
        return `Blynk: Order #${orderNumber} has been delivered. Thank you for shopping with Blynk Dharga Town!`;
      }

      case 'COD_PAYMENT_CONFIRMED': {
        const amount = Number(data.amount || 0).toFixed(2);
        return `Blynk: Cash payment of LKR ${amount} received for order #${orderNumber}. Payment status: PAID.`;
      }

      case 'DENTAL_APPOINTMENT_CONFIRMED': {
        const doctorName = (data.doctor_name as string) || 'your doctor';
        const clinicName = (data.clinic_name as string) || 'the clinic';
        const when = formatClinicDateTime(data.start_at as string);
        return `Blynk Dental: your appointment with Dr. ${doctorName} at ${clinicName} is confirmed for ${when}. The consultation fee is indicative and payable at the clinic.`;
      }

      case 'DENTAL_APPOINTMENT_CANCELLED': {
        const doctorName = (data.doctor_name as string) || 'your doctor';
        const clinicName = (data.clinic_name as string) || 'the clinic';
        const when = formatClinicDateTime(data.start_at as string);
        const cancelledBy = data.cancelled_by === 'clinic' ? 'by the clinic' : 'by you';
        const reason = data.reason ? ` Reason: ${data.reason as string}.` : '';
        return `Blynk Dental: your appointment with Dr. ${doctorName} at ${clinicName} on ${when} has been cancelled ${cancelledBy}.${reason}`;
      }

      // The day-before reminder sent by SMS when no app push is possible
      // (dental/appointment-reminders.ts): the same title and body as the push.
      // Rider applications (migration 029): the text is complete when queued.
      case 'RIDER_APPROVED':
      case 'RIDER_REJECTED':
      // Birthday SMS (migration 034, birthday/birthday.sms.ts): complete when queued.
      case 'BIRTHDAY_OFFER':
      case 'SMS_OFFER': {
        // Migration 027: the text is complete when queued (the customer's
        // language, opt-out line included), so it is sent exactly as written.
        return typeof data.text === 'string' ? data.text : '';
      }

      case 'DENTAL_APPOINTMENT_REMINDER': {
        const title = typeof data.title === 'string' ? data.title : 'Appointment tomorrow';
        const body = typeof data.body === 'string' ? data.body : '';
        return `Blynk: ${title} - ${body}`.trim();
      }

      // Push rows carry their own title and body (push/push.events.ts,
      // dental/appointment-reminders.ts).
      case 'PUSH_ORDER_STATUS':
      case 'PUSH_BACK_IN_STOCK':
      case 'PUSH_APPOINTMENT_REMINDER':
      case 'PUSH_RATING_PROMPT': {
        return typeof data.body === 'string' ? data.body : 'Blynk';
      }

      default: {
        return `Blynk notification for order #${orderNumber}.`;
      }
    }
  }

  /**
   * Sanitizes payloads before persistence in outbox to prevent accidental leakage of sensitive keys.
   */
  static sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const forbiddenKeys = [
      'purchase_cost',
      'actual_unit_cost',
      'estimated_unit_cost',
      'markup_percentage_applied',
      'custom_markup_percent',
      'effective_markup',
      'password',
      'otp',
      'otp_hash',
      'secret',
      'token',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!forbiddenKeys.includes(key.toLowerCase())) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
