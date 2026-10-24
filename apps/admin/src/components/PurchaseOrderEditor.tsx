import { useEffect, useState } from 'react';
import { products } from '../api/resources';
import type { AdminProduct } from '../api/types';
import type { OrderBody, SupplierOption } from '../api/purchasing';
import { Field } from './ui';
import { DatePicker } from './DatePicker';
import { errorMessage } from '../lib/apiErrors';
import { formatMoney } from '../lib/orders';
import type { OrderLineBody } from '../lib/purchasing';

/**
 * Builds the body of a purchase order by hand (a new order, or a DRAFT's lines): supplier, the day
 * it is needed, a note and product lines (search a product or one of its sizes, set quantity and
 * the expected cost). Orders made from Reorder suggestions skip this.
 */
export interface EditorLine {
  key: string;
  product_id: string;
  variant_id: string | null;
  name: string;
  qty: string;
  cost: string;
}

export interface EditorValue {
  supplier_id: string;
  expected_on: string;
  notes: string;
  lines: EditorLine[];
}

export const emptyEditor: EditorValue = { supplier_id: '', expected_on: '', notes: '', lines: [] };

const keyOf = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ''}`;

/** The request body from the form, or the first thing wrong with it. */
export function editorBody(v: EditorValue): { ok: true; body: OrderBody & { lines: OrderLineBody[] } } | { ok: false; error: string } {
  if (v.lines.length === 0) return { ok: false, error: 'Add at least one product.' };
  const lines: OrderLineBody[] = [];
  for (const l of v.lines) {
    if (!/^\d{1,6}$/.test(l.qty.trim()) || Number(l.qty) < 1) return { ok: false, error: `Enter a quantity of 1 or more for ${l.name}.` };
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(l.cost.trim())) return { ok: false, error: `Enter a valid cost for ${l.name} (at most 2 decimals).` };
    lines.push({ product_id: l.product_id, variant_id: l.variant_id, ordered_qty: Number(l.qty), unit_cost: Number(l.cost) });
  }
  return {
    ok: true,
    body: { supplier_id: v.supplier_id || null, expected_on: v.expected_on || null, notes: v.notes.trim() || null, lines },
  };
}

export function OrderEditor({
  value,
  onChange,
  suppliers,
  linesOnly = false,
}: {
  value: EditorValue;
  onChange(next: EditorValue): void;
  suppliers: SupplierOption[];
  /** Only the lines (editing a draft keeps the supplier etc. in the order header). */
  linesOnly?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ key: string; productId: string; variantId: string | null; name: string; cost: number }[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      products
        .searchAdmin(q, 8)
        .then(async (found) => {
          const out: typeof results = [];
          for (const p of found as AdminProduct[]) {
            if (p.has_variants) {
              const full = await products.getAdmin(p.id).catch(() => null);
              for (const v of full?.variants ?? []) {
                if (v.is_active) out.push({ key: keyOf(p.id, v.id), productId: p.id, variantId: v.id, name: `${p.name} - ${v.label}`, cost: Number(v.purchase_cost) });
              }
            } else {
              out.push({ key: keyOf(p.id, null), productId: p.id, variantId: null, name: p.name, cost: Number(p.purchase_cost) });
            }
          }
          if (live) setResults(out);
        })
        .catch((err) => live && setMessage(errorMessage(err, 'Could not search products.')));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  function add(r: (typeof results)[number]) {
    setMessage(null);
    if (value.lines.some((l) => l.key === r.key)) {
      setMessage(`${r.name} is already on the order.`);
      return;
    }
    onChange({ ...value, lines: [...value.lines, { key: r.key, product_id: r.productId, variant_id: r.variantId, name: r.name, qty: '1', cost: r.cost.toFixed(2) }] });
    setSearch('');
    setResults([]);
  }

  const setLine = (key: string, patch: Partial<EditorLine>) => onChange({ ...value, lines: value.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const total = value.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  return (
    <div className="po-panel">
      {linesOnly ? null : (
        <>
          <Field label="Supplier">
            <select className="input" aria-label="Supplier" value={value.supplier_id} onChange={(e) => onChange({ ...value, supplier_id: e.target.value })}>
              <option value="">No supplier yet</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span className="field__label">Needed by (optional)</span>
            <DatePicker label="Needed by" value={value.expected_on} onChange={(expected_on) => onChange({ ...value, expected_on })} placeholder="No day" markPast={false} />
          </div>
          <Field label="Note for the supplier (optional)">
            <input className="input" aria-label="Note" maxLength={500} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
          </Field>
        </>
      )}

      <div className="po-picker">
        <Field label="Add a product">
          <input className="input" type="search" aria-label="Search products to add" placeholder="Type at least 2 letters" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {results.length > 0 ? (
          <ul className="po-picker__results" aria-label="Products found">
            {results.map((r) => (
              <li key={r.key}>
                <button type="button" onClick={() => add(r)}>
                  {r.name} <span className="cell__secondary">· cost {formatMoney(r.cost)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {message ? <p className="field__error">{message}</p> : null}

      {value.lines.length === 0 ? (
        <p className="cell__secondary">No products yet. Search above to add one.</p>
      ) : (
        <div className="table-wrap">
          <table className="table po-lines" aria-label="Order lines">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Quantity
                </th>
                <th scope="col" className="num">
                  Cost each
                </th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {value.lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.name}</td>
                  <td className="num">
                    <input className="input input--qty" inputMode="numeric" aria-label={`${l.name} quantity`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/\D/g, '') })} />
                  </td>
                  <td className="num">
                    <input className="input input--cost" inputMode="decimal" aria-label={`${l.name} cost`} value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} />
                  </td>
                  <td className="num mono">{formatMoney((Number(l.qty) || 0) * (Number(l.cost) || 0))}</td>
                  <td>
                    <button type="button" className="button button--ghost button--sm" onClick={() => onChange({ ...value, lines: value.lines.filter((x) => x.key !== l.key) })}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="po-note">Estimated total {formatMoney(total)}</p>
    </div>
  );
}
