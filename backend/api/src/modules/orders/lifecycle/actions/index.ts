import type { ActionName } from '../catalogue.js';
import type { ActionImpl } from '../types.js';
import { customerCancel } from './customer.js';
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

/** Implementation of every catalogue action (plan §O.2 rows #1-#14). */
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
};
