import type { OrderCombo, OrderItemRow } from '../api/types';
import { groupOrderItems, type DisplayItem } from '../lib/combos';
import { ITEM_STATUS_LABEL, formatMoney } from '../lib/orders';

/**
 * An order's items. Combo packs (owner, 2026-10-09) come first, each as
 * "Breakfast pack × 2 — LKR 1,100" with its products under it; loose items
 * follow as before.
 */
export function OrderItems({
  items,
  combos,
  renderAction,
}: {
  items: ReadonlyArray<OrderItemRow>;
  combos?: ReadonlyArray<OrderCombo>;
  /** Extra control for one item line (e.g. Mark unavailable). */
  renderAction?(item: OrderItemRow): React.ReactNode;
}) {
  const grouped = groupOrderItems(items, combos);
  const row = (line: DisplayItem) => (
    <li key={line.key} className={`order-items__row order-items__row--${line.item_status.toLowerCase()}`}>
      <span className="order-items__qty mono">{line.quantity} ×</span>
      <span className="order-items__name">{line.product_name_snapshot}</span>
      <span className="order-items__status">{ITEM_STATUS_LABEL[line.item_status] ?? line.item_status}</span>
      {renderAction ? renderAction(line.item) : null}
    </li>
  );

  return (
    <ul className="order-items">
      {grouped.combos.map(({ combo, items: lines }) => (
        <li key={combo.id} className="order-combo" aria-label={`Combo ${combo.name}`}>
          <p className="order-combo__head">
            <span className="order-combo__tag">Combo</span>
            <span className="order-combo__name">
              {combo.name} × {combo.quantity}
            </span>
            <span className="order-combo__price mono">{formatMoney(combo.subtotal)}</span>
          </p>
          <ul className="order-items order-combo__items">{lines.map(row)}</ul>
        </li>
      ))}
      {grouped.loose.map(row)}
    </ul>
  );
}
