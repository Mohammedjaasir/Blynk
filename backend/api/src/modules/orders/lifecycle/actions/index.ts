import type { ActionName } from '../catalogue.js';
import type { ActionImpl } from '../types.js';
import { customerCancel } from './customer.js';
import { paymentConfirmed, paymentExpired } from './payment.js';
import { handToRider, pack, resolveItem } from './store.js';
import { riderArrive, riderCollectCod, riderFail, riderPickup } from './rider.js';
import {
  adminCancel,
  adminMarkCustomerUnavailable,
  adminMarkDelivered,
  adminMarkFailed,
  assignRider,
  restage,
} from './admin.js';

/** Implementation of every catalogue action (plan §O.2 rows #1-#14, plus the two PayHere actions of migration 047). */
export const ACTIONS: Record<ActionName, ActionImpl<any>> = {
  CUSTOMER_CANCEL: customerCancel,
  RESOLVE_ITEM: resolveItem,
  PACK: pack,
  ASSIGN_RIDER: assignRider,
  HAND_TO_RIDER: handToRider,
  RIDER_PICKUP: riderPickup,
  RIDER_ARRIVE: riderArrive,
  RIDER_FAIL: riderFail,
  RIDER_COLLECT_COD: riderCollectCod,
  ADMIN_MARK_DELIVERED: adminMarkDelivered,
  ADMIN_MARK_FAILED: adminMarkFailed,
  ADMIN_MARK_CUSTOMER_UNAVAILABLE: adminMarkCustomerUnavailable,
  ADMIN_CANCEL: adminCancel,
  RESTAGE: restage,
  PAYMENT_CONFIRMED: paymentConfirmed,
  PAYMENT_EXPIRED: paymentExpired,
};
