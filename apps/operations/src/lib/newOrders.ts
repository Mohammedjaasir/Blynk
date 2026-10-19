/*
 * New-order alerts (owner, 2026-10-19: "Ops app should send notifications when order received").
 * Pure: which orders in the packing queue are new since the last look. The first look only
 * learns what is already there - opening the app never rings for old orders.
 */

export interface SeenOrder { id: string; order_number: string; order_status: string }

/** How often the app checks the packing queue, ms. */
export const NEW_ORDER_POLL_MS = 20_000;

export function newOrdersSince(seen: Set<string> | null, current: SeenOrder[]): { fresh: SeenOrder[]; seen: Set<string> } {
  const next = new Set(current.map((o) => o.id));
  if (seen === null) return { fresh: [], seen: next };
  // only just-placed orders ring (an ITEM_UNAVAILABLE one was already seen as PLACED)
  const fresh = current.filter((o) => !seen.has(o.id) && o.order_status === 'PLACED');
  // keep remembering older ids too, so an order that leaves and comes back does not ring twice
  for (const id of seen) next.add(id);
  return { fresh, seen: next };
}

export function newOrderText(fresh: SeenOrder[]): { title: string; body: string } {
  if (fresh.length === 1) return { title: 'New order received', body: `Order ${fresh[0]!.order_number} is waiting to be packed.` };
  return { title: `${fresh.length} new orders`, body: `${fresh.map((o) => o.order_number).join(', ')} are waiting to be packed.` };
}
