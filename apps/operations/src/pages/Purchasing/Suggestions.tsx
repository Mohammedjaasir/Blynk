import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { purchasing, purchasingError, type SupplierOption } from '../../api/purchasing';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner } from '../../components/ui';
import { whatsappUrl } from '../../lib/insights';
import { formatMoney } from '../../lib/orders';
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
  type ReorderSuggestions,
} from '../../lib/purchasing';
import './purchasing.css';

/**
 * More -> Purchasing -> Reorder suggestions (owner, 2026-10-25): what to buy and from whom, from
 * what sold in the last 14 or 28 days against the stock on the shelf. Tick the products, set the
 * quantities, then "Create order" per supplier makes a draft purchase order to send.
 */
const COVER_CHOICES = [3, 7, 14, 21, 28];
const REASONS: (ReorderReason | 'ALL')[] = ['ALL', 'OUT', 'LOW', 'WONT_LAST', 'FAST'];

export function Suggestions() {
  const [days, setDays] = useState<14 | 28>(14);
  const [cover, setCover] = useState(7);
  const [data, setData] = useState<ReorderSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      const d = await purchasing.suggestions({ days, cover_days: cover, lead_days: 1 });
      const sel = initialSelection(d);
      setData(d);
      setQty(sel.qty);
      setPicked(sel.picked);
      setCreated({});
    } catch (err) {
      setError(purchasingError(err, 'Could not load the reorder suggestions.'));
    }
  }, [days, cover]);

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
  const groups = useMemo<ReorderGroup[]>(
    () =>
      (data?.suppliers ?? [])
        .map((g) => ({ ...g, items: g.items.filter((i) => matchesFilter(i, filter)) }))
        .filter((g) => g.items.length > 0),
    [data, filter]
  );

  const pickedLines = (g: ReorderGroup) => g.items.filter((i) => picked[itemKey(i)] && (qty[itemKey(i)] ?? 0) > 0);
  const groupCost = (g: ReorderGroup) => pickedLines(g).reduce((s, i) => s + lineCostOf(i, qty[itemKey(i)] ?? 0), 0);

  async function createOrder(g: ReorderGroup) {
    const body = orderBodyFor(g, qty, picked, { supplier_id: g.supplier_id ?? (chosen[supplierKey(g)] || null) });
    if (body.lines.length === 0) {
      setNotice('Tick at least one product with a quantity above 0.');
      return;
    }
    setBusy(true);
    try {
      const po = await purchasing.create(body);
      setCreated((c) => ({ ...c, [supplierKey(g)]: { id: po.id, po_number: po.po_number } }));
      setNotice(`Draft ${po.po_number} created.`);
    } catch (err) {
      setNotice(purchasingError(err, 'Could not create the order.'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(g: ReorderGroup) {
    try {
      await navigator.clipboard.writeText(suggestionText(g, qty, picked));
      setNotice(`Order for ${supplierLabel(g.supplier_name)} copied.`);
    } catch {
      setNotice('Could not copy on this phone. Create the order and use WhatsApp.');
    }
  }

  return (
    <div className="page">
      <Link to="/more/purchasing" className="link">
        ← Purchasing
      </Link>
      <PageHeader title="Reorder suggestions" description="What to buy, from what sold recently against what is on the shelf." />

      <div className="po-pills segmented" role="group" aria-label="Sales window">
        {([14, 28] as const).map((d) => (
          <button key={d} type="button" className={d === days ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={d === days} onClick={() => setDays(d)}>
            Last {d} days
          </button>
        ))}
      </div>
      <div className="po-bar">
        <select className="input" aria-label="Cover days" value={cover} onChange={(e) => setCover(Number(e.target.value))}>
          {COVER_CHOICES.map((c) => (
            <option key={c} value={c}>
              Cover {c} days
            </option>
          ))}
        </select>
        <input className="input" type="search" aria-label="Filter products" placeholder="Find a product" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="po-pills segmented" role="group" aria-label="Reason">
        {REASONS.map((r) => (
          <button key={r} type="button" className={r === reason ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={r === reason} onClick={() => setReason(r)}>
            {r === 'ALL' ? 'All' : REASON_LABEL[r]}
          </button>
        ))}
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="po-created" role="status">
          {notice}
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Loading the reorder suggestions" /> : null}

      {data && data.suppliers.length === 0 ? <EmptyState title="Nothing to reorder" message="Stock covers the sales of the next days." /> : null}
      {data && data.suppliers.length > 0 && groups.length === 0 ? <EmptyState title="No product matches" message="Change the search or the reason." /> : null}

      {groups.map((g) => {
        const key = supplierKey(g);
        const name = supplierLabel(g.supplier_name);
        const done = created[key];
        return (
          <section key={key} className="card" aria-label={name}>
            <div className="po-card__head">
              <p className="po-card__title">{name}</p>
              <span className="po-card__title">{formatMoney(groupCost(g))}</span>
            </div>
            {done ? (
              <p className="po-created" role="status">
                Draft {done.po_number} created. <Link to={`/more/purchasing/${done.id}`}>Open it to send</Link>.
              </p>
            ) : null}
            {g.supplier_id === null && !done ? (
              <select className="input" aria-label={`Supplier for ${name}`} value={chosen[key] ?? ''} onChange={(e) => setChosen((c) => ({ ...c, [key]: e.target.value }))}>
                <option value="">Choose a supplier (or decide later)</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}

            <div>
              {g.items.map((i) => {
                const k = itemKey(i);
                const q = qty[k] ?? 0;
                const on = !!picked[k];
                return (
                  <div key={k} className={on && q > 0 ? 'po-row' : 'po-row is-muted'}>
                    <input
                      className="po-row__check"
                      type="checkbox"
                      aria-label={`Tick ${i.display_name}`}
                      checked={on}
                      onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
                    />
                    <div className="po-row__body">
                      <p className="po-card__title">{i.display_name}</p>
                      <div className="po-chips">
                        {i.reasons.map((r) => (
                          <span key={r} className={`po-chip po-chip--${r.toLowerCase()}`}>
                            {REASON_LABEL[r]}
                          </span>
                        ))}
                      </div>
                      <p className="po-meta">
                        {i.quantity_available} on hand · sells {perDayText(i.avg_daily_units)} · lasts {daysLeftText(i.days_of_stock_left)}
                        {i.on_order > 0 ? ` · ${i.on_order} on order` : ''}
                      </p>
                      {i.in_draft > 0 ? <p className="po-meta po-meta--warn">{i.in_draft} already in a draft order</p> : null}
                      {i.buy_multiple ? <p className="po-meta">Bought in packs of {i.buy_multiple}</p> : null}
                      <div className="po-row__line">
                        <span className="po-meta">
                          {formatMoney(i.last_cost)} each · {formatMoney(lineCostOf(i, q))}
                        </span>
                        <input
                          className="input po-input"
                          inputMode="numeric"
                          aria-label={`${i.display_name} quantity`}
                          value={q}
                          onChange={(e) => setQty((s) => ({ ...s, [k]: clampQty(Number(e.target.value.replace(/\D/g, ''))) }))}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="po-actions">
              {done ? null : (
                <button type="button" className="button button--ink" disabled={busy || pickedLines(g).length === 0} onClick={() => void createOrder(g)} aria-label={`Create order for ${name}`}>
                  Create order
                </button>
              )}
              <button type="button" className="button button--ghost" onClick={() => void copy(g)}>
                Copy
              </button>
              <a className="button po-whatsapp" href={whatsappUrl(suggestionText(g, qty, picked), g.supplier_phone)} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            </div>
          </section>
        );
      })}
    </div>
  );
}
