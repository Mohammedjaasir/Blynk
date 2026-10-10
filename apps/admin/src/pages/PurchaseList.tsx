import { useEffect, useState } from 'react';
import { insights, type PurchaseList as PurchaseListData, type PurchaseSupplierGroup } from '../api/insights';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { lineCost, lineName, purchaseCsv, purchaseText, whatsappUrl, type PurchaseLine } from '../lib/insights';
import { formatMoney } from '../lib/orders';
import { downloadBlob } from '../lib/productImport';

/**
 * Purchase list (owner, 2026-10-10): a supplier order made from what is
 * running low (GET /admin/inventory/purchase-list) - the same list the
 * Operations app shows under Catalog → Inventory. Grouped by the supplier
 * each product was last bought from. Quantities can be changed (0 leaves a
 * product out); copy, WhatsApp or CSV. There are no purchase orders in the
 * system: stock is received with Restock as usual.
 */
export function PurchaseList() {
  const toast = useToast();
  const [data, setData] = useState<PurchaseListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  useEffect(() => {
    let live = true;
    insights
      .purchaseList()
      .then((d) => {
        if (!live) return;
        setData(d);
        setQty(Object.fromEntries(d.items.map((i) => [i.product_id, i.suggested_quantity])));
      })
      .catch((err) => live && setError(errorMessage(err, 'Could not load the purchase list.')));
    return () => {
      live = false;
    };
  }, []);

  const linesOf = (g: PurchaseSupplierGroup): PurchaseLine[] => g.items.map((item) => ({ item, quantity: qty[item.product_id] ?? item.suggested_quantity }));
  const allLines = data ? data.suppliers.flatMap(linesOf) : [];
  const allText = data
    ? data.suppliers
        .map((g) => purchaseText(g.supplier_name, linesOf(g)))
        .filter((t) => t.includes('\n'))
        .join('\n\n')
    : '';

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error('Could not copy. Use the CSV instead.');
    }
  }

  const setQuantity = (productId: string, value: number) =>
    setQty((q) => ({ ...q, [productId]: Math.max(0, Math.min(99999, Math.round(value) || 0)) }));

  return (
    <>
      <PageHeader
        title="Purchase list"
        description="What to buy from suppliers, made from what is running low."
        actions={
          data && data.items.length > 0 ? (
            <>
              <button type="button" className="button button--ghost" onClick={() => void copy(allText, 'Purchase list')}>
                Copy all
              </button>
              <button
                type="button"
                className="button"
                onClick={() => downloadBlob(new Blob([purchaseCsv(allLines)], { type: 'text/csv;charset=utf-8' }), 'blynk-purchase-list.csv')}
              >
                Download CSV
              </button>
            </>
          ) : null
        }
      />

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading the purchase list" /> : null}

      {data ? (
        <>
          <p className="form__note purchase-rule">{data.rule} Change any quantity; 0 leaves the product out. Cost is estimated from each product's purchase cost.</p>
          {data.items.length === 0 ? (
            <EmptyState title="Nothing is running low" message="No purchase needed. Products appear here at or below their low-stock level." />
          ) : (
            <>
              <div className="figures" aria-label="Purchase totals">
                <Stat value={String(allLines.filter((l) => l.quantity > 0).length)} label="Products" />
                <Stat value={String(allLines.reduce((s, l) => s + l.quantity, 0))} label="Units" />
                <Stat value={formatMoney(lineCost(allLines))} label="Estimated cost" />
              </div>

              {data.suppliers.map((g) => {
                const lines = linesOf(g);
                const text = purchaseText(g.supplier_name, lines);
                const name = g.supplier_name ?? 'No supplier yet';
                return (
                  <section key={g.supplier_id ?? 'none'} className="attention purchase-group" aria-label={name}>
                    <div className="purchase-group__head">
                      <h2 className="purchase-group__name">
                        {name}
                        {g.supplier_phone ? <span className="cell__secondary"> · {g.supplier_phone}</span> : null}
                      </h2>
                      <div className="purchase-group__actions">
                        <span className="mono purchase-group__cost">{formatMoney(lineCost(lines))}</span>
                        <button type="button" className="button button--ghost button--sm" onClick={() => void copy(text, `Order for ${name}`)}>
                          Copy
                        </button>
                        <a className="button button--sm purchase-whatsapp" href={whatsappUrl(text, g.supplier_phone)} target="_blank" rel="noreferrer">
                          WhatsApp
                        </a>
                      </div>
                    </div>
                    {g.supplier_id === null ? <p className="cell__secondary">Never bought from a named supplier yet.</p> : null}
                    <div className="table-wrap">
                      <table className="table" aria-label={`Order for ${name}`}>
                        <thead>
                          <tr>
                            <th scope="col">Product</th>
                            <th scope="col" className="num">
                              Available
                            </th>
                            <th scope="col" className="num">
                              Low at
                            </th>
                            <th scope="col" className="num">
                              Target
                            </th>
                            <th scope="col" className="num">
                              Quantity
                            </th>
                            <th scope="col" className="num">
                              Unit cost
                            </th>
                            <th scope="col" className="num">
                              Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(({ item, quantity }) => (
                            <tr key={item.product_id} className={quantity === 0 ? 'is-muted' : undefined}>
                              <td>
                                {lineName(item)}
                                <span className="cell__secondary"> · {item.product_sku}</span>
                                {item.stock_state === 'OUT' ? <span className="zone-tag zone-tag--outside">Out</span> : null}
                              </td>
                              <td className="num mono">{item.quantity_available}</td>
                              <td className="num mono">{item.low_stock_threshold}</td>
                              <td className="num mono">{item.target_level}</td>
                              <td className="num">
                                <input
                                  className="input input--qty"
                                  inputMode="numeric"
                                  aria-label={`${item.product_name} quantity`}
                                  value={quantity}
                                  onChange={(e) => setQuantity(item.product_id, Number(e.target.value.replace(/\D/g, '')))}
                                />
                              </td>
                              <td className="num mono">{formatMoney(item.unit_cost)}</td>
                              <td className="num mono">{formatMoney(item.unit_cost * quantity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </>
      ) : null}
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="figure">
      <span className="figure__value figure__value--sm">{value}</span>
      <span className="figure__label">{label}</span>
    </div>
  );
}
