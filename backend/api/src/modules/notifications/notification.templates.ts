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
        return `Blynk: Order #${orderNumber} is now OUT FOR DELIVERY! Please keep exact cash of LKR ${total} ready for COD.`;
      }

      case 'DELIVERED': {
        return `Blynk: Order #${orderNumber} has been delivered. Thank you for shopping with Blynk Dharga Town!`;
      }

      case 'COD_PAYMENT_CONFIRMED': {
        const amount = Number(data.amount || 0).toFixed(2);
        return `Blynk: Cash payment of LKR ${amount} received for order #${orderNumber}. Payment status: PAID.`;
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
