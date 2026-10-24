import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { purchasing, purchasingError, type SupplierOption } from '../api/purchasing';
import { PageHeader } from '../components/Layout';
import { EmptyState, Field, Spinner, useToast } from '../components/ui';
import { whatsappUrl } from '../lib/insights';
import { formatMoney } from '../lib/orders';
import {
  REASON_LABEL,
  clampQty,
  daysLeftText,
  initialSelection,
  itemKey,
  lineCostOf,
  matchesFilter,
  orderBodyFor,
  perDayText,
  suggestionText,
  supplierKey,
  supplierLabel,
  type ReorderGroup,
  type ReorderReason,
  type ReorderSuggestions as Suggestions,
} from '../lib/purchasing';
import './purchasing.css';

/**
 * Reorder suggestions (owner, 2026-10-25; GET /admin/reorder-suggestions): what to buy, from whom
 * and how much, worked out from what sold in the last 14 or 28 days against the stock on hand and
 * the days the supplier takes. Tick the lines, change quantities, then "Create purchase order" per
 * supplier makes a DRAFT order (Purchase orders) to send. The older Purchase list stays as it was.
 */
const COVER_CHOICES = [3, 7, 14, 21, 28];
const REASONS: (ReorderReason | 'ALL')[] = ['ALL', 'OUT', 'LOW', 'WONT_LAST', 'FAST'];

export function ReorderSuggestions() {
  const toast = useToast();
  const [days, setDays] = useState<14 | 28>(14);
  const [cover, setCover] = useState(7);
  const [lead, setLead] = useState(1);
  const [data, setData] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [text, setText] = useState('');
  const [reason, setReason] = useState<ReorderReason | 'ALL'>('ALL');
  const [created, setCreated] = useState<Record<string, { id: string; po_number: string }>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    setError(null);
    try {
      const d = await purchasing.suggestions({ days, cover_days: cover, lead_days: lead });
      const sel = initialSelection(d);
      setData(d);
      setQty(sel.qty);
      setPicked(sel.picked);
      setCreated({});
    } catch (err) {
      setError(purchasingError(err, 'Could not load the reorder suggestions.'));
    }
  }, [days, cover, lead]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    purchasing
      .suppliers()
      .then(setSuppliers)
      .catch(() => undefined);
  }, []);

  const filter = useMemo(() => ({ text, reason }), [text, reason]);
  // Groups with only the lines the filter shows; orders are made from what is shown and ticked.
  const groups = useMemo<ReorderGroup[]>(
    () =>
      (data?.suppliers ?? [])
        .map((g) => ({ ...g, items: g.items.filter((i) => matchesFilter(i, filter)) }))
        .filter((g) => g.items.length > 0),
    [data, filter]
  );

  const pickedLines = (g: ReorderGroup) => g.items.filter((i) => picked[itemKey(i)] && (qty[itemKey(i)] ?? 0) > 0);
  const groupCost = (g: ReorderGroup) => pickedLines(g).reduce((s, i) => s + lineCostOf(i, qty[itemKey(i)] ?? 0), 0);
  const creatable = groups.filter((g) => !created[supplierKey(g)] && pickedLines(g).length > 0);

  function supplierFor(g: ReorderGroup): string | null {
    return g.supplier_id ?? (chosen[supplierKey(g)] || null);
  }

  async function createOrder(g: ReorderGroup): Promise<boolean> {
    const body = orderBodyFor(g, qty, picked, { supplier_id: supplierFor(g) });
    if (body.lines.length === 0) {
      toast.error('Tick at least one product with a quantity above 0.');
      return false;
    }
    try {
      const po = await purchasing.create(body);
      setCreated((c) => ({ ...c, [supplierKey(g)]: { id: po.id, po_number: po.po_number } }));
      toast.success(`Draft ${po.po_number} created for ${supplierLabel(po.supplier_name ?? g.supplier_name)}.`);
      return true;
    } catch (err) {
      toast.error(purchasingError(err, `Could not create the order for ${supplierLabel(g.supplier_name)}.`));
      return false;
    }
  }

  async function createAll() {
    setBusy(true);
    try {
      for (const g of creatable) {
        if (!(await createOrder(g))) break;
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(g: ReorderGroup) {
    try {
      await navigator.clipboard.writeText(suggestionText(g, qty, picked));
      toast.success(`Order for ${supplierLabel(g.supplier_name)} copied.`);
    } catch {
      toast.error('Could not copy. Create the order and use its Copy button.');
    }
  }

  const toggleGroup = (g: ReorderGroup, on: boolean) => setPicked((p) => ({ ...p, ...Object.fromEntries(g.items.map((i) => [itemKey(i), on])) }));

  return (
    <>
      <PageHeader
        title="Reorder suggestions"
        description="What to buy and from whom, from what sold recently against what is on the shelf. Tick the lines, change a quantity, then create a purchase order per supplier."
        actions={
          <>
            <Link className="button button--ghost" to="/purchase-orders">
              Purchase orders
            </Link>
            {creatable.length > 0 ? (
              <button type="button" className="button" disabled={busy} onClick={() => void createAll()}>
                Create purchase orders ({creatable.length})
              </button>
            ) : null}
          </>
        }
      />

      <div className="po-toolbar">
        <div className="segmented" role="group" aria-label="Sales window">
          {([14, 28] as const).map((d) => (
            <button key={d} type="button" className={d === days ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={d === days} onClick={() => setDays(d)}>
              Last {d} days
            </button>
          ))}
        </div>
        <Field label="Cover (days of sales)">
          <select className="input" aria-label="Cover days" value={cover} onChange={(e) => setCover(Number(e.target.value))}>
            {COVER_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c} days
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier takes (days)">
          <input
            className="input input--qty"
            inputMode="numeric"
            aria-label="Supplier lead days"
            value={lead}
            onChange={(e) => setLead(Math.min(30, Number(e.target.value.replace(/\D/g, '')) || 0))}
          />
        </Field>
        <Field label="Find a product">
          <input className="input" type="search" aria-label="Filter products" placeholder="Name, SKU or category" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="segmented" role="group" aria-label="Reason">
          {REASONS.map((r) => (
            <button key={r} type="button" className={r === reason ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={r === reason} onClick={() => setReason(r)}>
              {r === 'ALL' ? 'All' : REASON_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Loading the reorder suggestions" /> : null}

      {data ? (
        <>
          <p className="form__note purchase-rule">{data.rule}</p>
          {data.suppliers.length === 0 ? (
            <EmptyState title="Nothing to reorder" message="Stock covers the sales of the next days for every counted product." />
          ) : groups.length === 0 ? (
            <EmptyState title="No product matches" message="Change the search or the reason filter." />
          ) : (
            groups.map((g) => {
              const key = supplierKey(g);
              const name = supplierLabel(g.supplier_name);
              const done = created[key];
              const allOn = g.items.every((i) => picked[itemKey(i)]);
              const share = suggestionText(g, qty, picked);
              return (
                <section key={key} className="attention purchase-group" aria-label={name}>
                  <div className="purchase-group__head">
                    <h2 className="purchase-group__name">
                      {name}
                      {g.supplier_phone ? <span className="cell__secondary"> · {g.supplier_phone}</span> : null}
                    </h2>
                    <div className="purchase-group__actions">
                      <span className="mono purchase-group__cost">{formatMoney(groupCost(g))}</span>
                      <button type="button" className="button button--ghost button--sm" onClick={() => void copy(g)}>
                        Copy
                      </button>
                      <a className="button button--sm purchase-whatsapp" href={whatsappUrl(share, g.supplier_phone)} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                      {done ? null : (
                        <button
                          type="button"
                          className="button button--sm"
                          disabled={busy || pickedLines(g).length === 0}
                          onClick={() => void createOrder(g)}
                          aria-label={`Create purchase order for ${name}`}
                        >
                          Create purchase order
                        </button>
                      )}
                    </div>
                  </div>

                  {done ? (
                    <p className="po-created" role="status">
                      Draft {done.po_number} created. <Link to={`/purchase-orders/${done.id}`}>Open it to send</Link>.
                    </p>
                  ) : null}
                  {g.supplier_id === null && !done ? (
                    <div className="po-group__supplier">
                      <span className="cell__secondary">Never bought from a named supplier.</span>
                      <select
                        className="input"
                        aria-label="Supplier for this order"
                        value={chosen[key] ?? ''}
                        onChange={(e) => setChosen((c) => ({ ...c, [key]: e.target.value }))}
                      >
                        <option value="">Choose a supplier (or decide later)</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="table-wrap">
                    <table className="table po-lines" aria-label={`Suggestions for ${name}`}>
                      <thead>
                        <tr>
                          <th scope="col">
                            <input type="checkbox" aria-label={`Tick all for ${name}`} checked={allOn} onChange={(e) => toggleGroup(g, e.target.checked)} />
                          </th>
                          <th scope="col">Product</th>
                          <th scope="col" className="num">
                            On hand
                          </th>
                          <th scope="col" className="num">
                            Sells
                          </th>
                          <th scope="col" className="num">
                            Stock lasts
                          </th>
                          <th scope="col" className="num">
                            On order
                          </th>
                          <th scope="col" className="num">
                            Quantity
                          </th>
                          <th scope="col" className="num">
                            Last cost
                          </th>
                          <th scope="col" className="num">
                            Cost
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((i) => {
                          const k = itemKey(i);
                          const q = qty[k] ?? 0;
                          const on = !!picked[k];
                          return (
                            <tr key={k} className={on && q > 0 ? undefined : 'is-muted'}>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`Tick ${i.display_name}`}
                                  checked={on}
                                  onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
                                />
                              </td>
                              <td>
                                {i.display_name}
                                <span className="cell__secondary"> · {i.sku}</span>
                                <span className="reason-chips">
                                  {i.reasons.map((r) => (
                                    <span key={r} className={`reason-chip reason-chip--${r.toLowerCase()}`}>
                                      {REASON_LABEL[r]}
                                    </span>
                                  ))}
                                </span>
                                {i.in_draft > 0 ? <p className="po-note">{i.in_draft} already in a draft order</p> : null}
                                {i.buy_multiple ? <p className="po-note">Bought in packs of {i.buy_multiple}</p> : null}
                              </td>
                              <td className="num mono">{i.quantity_available}</td>
                              <td className="num mono">{perDayText(i.avg_daily_units)}</td>
                              <td className="num mono">{daysLeftText(i.days_of_stock_left)}</td>
                              <td className="num mono">{i.on_order}</td>
                              <td className="num">
                                <input
                                  className="input input--qty"
                                  inputMode="numeric"
                                  aria-label={`${i.display_name} quantity`}
                                  value={q}
                                  onChange={(e) => setQty((s) => ({ ...s, [k]: clampQty(Number(e.target.value.replace(/\D/g, ''))) }))}
                                />
                              </td>
                              <td className="num mono">{formatMoney(i.last_cost)}</td>
                              <td className="num mono">{formatMoney(lineCostOf(i, q))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })
          )}
        </>
      ) : null}
    </>
  );
}
