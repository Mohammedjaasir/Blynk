import type { Selectable, Transaction } from 'kysely';
import type {
  Database,
  DeliveriesTable,
  OrderItemsTable,
  OrdersTable,
  UserRole,
} from '../../../database/types.js';

export type Trx = Transaction<Database>;
export type OrderRow = Selectable<OrdersTable>;
export type ItemRow = Selectable<OrderItemsTable>;
export type DeliveryRow = Selectable<DeliveriesTable>;

/** Who is asking: the verified user from the access token. */
export interface Actor {
  id: string;
  role: UserRole;
}

export interface TransitionInput {
  /** Staff note; required by the actions the catalogue marks notesRequired. */
  notes?: string;
  /** Cash counted by the rider (RIDER_COLLECT_COD). */
  amount?: number;
  /** The rider's reason (RIDER_FAIL). */
  failure_reason?: string;
  /** RESOLVE_ITEM outcome. */
  item_status?: 'UNAVAILABLE' | 'SUBSTITUTED';
  /** ASSIGN_RIDER target. */
  rider_id?: string;
  /** CUSTOMER_CANCEL: the customer's own reason. */
  reason?: string;
}

export interface TransitionRequest {
  actor: Actor;
  orderId?: string;
  itemId?: string;
  /** Rider actions: the delivery in the URL ... */
  deliveryId?: string;
  /** ... and the caller's rider profile, which must own it. */
  riderId?: string;
  input?: TransitionInput;
}

/** The rows an action decides on, as read under its locks. */
export interface LockedState {
  order: OrderRow;
  item?: ItemRow;
  items?: ItemRow[];
  delivery?: DeliveryRow;
  activeDeliveries?: DeliveryRow[];
}

/**
 * One lifecycle action. checkState and checkPreconditions are pure: they
 * decide from the locked rows alone and throw the documented AppError. apply
 * performs the effects inside the same transaction.
 */
export interface ActionImpl<R = unknown> {
  /** Ownership and state checks, in the documented order of precedence. */
  checkState(state: LockedState, req: TransitionRequest): void;
  /** Conditions that only matter once the caller may act (after the role check). */
  checkPreconditions?(state: LockedState, req: TransitionRequest): void;
  apply(trx: Trx, state: LockedState, req: TransitionRequest): Promise<R>;
}
