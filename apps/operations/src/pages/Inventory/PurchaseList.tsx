import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { insights, type PurchaseList as PurchaseListData, type PurchaseSupplierGroup } from '../../api/insights';
import { PageHeader } from '../../components/Layout';
import { Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { lineCost, lineName, purchaseCsv, purchaseText, whatsappUrl, type PurchaseLine } from '../../lib/insights';
import { formatMoney } from '../../lib/orders';
import { downloadBlob } from '../../lib/productImport';

/**
 * Purchase list (owner, 2026-10-10): a supplier order made from what is
 * running low (GET /admin/inventory/purchase-list). Grouped by the supplier
 * each product was last bought from; the suggested quantity can be changed
 * (0 leaves a product out). Copy, WhatsApp or CSV - there are no purchase
 * orders in the system, so stock is received with Restock as usual.
 */
export function PurchaseList() {
  const [data, setData] = useState<PurchaseListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
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
  }, [reload]);

  const linesOf = (g: PurchaseSupplierGroup): PurchaseLine[] => g.items.map((item) => ({ item, quantity: qty[item.product_id] ?? item.suggested_quantity }));
  const allLines = useMemo(() => (data ? data.suppliers.flatMap(linesOf) : []), [data, qty]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${what} copied.`);
    } catch {
      setNotice('Could not copy on this phone. Use WhatsApp or the CSV instead.');
    }
  }

  function setQuantity(productId: string, value: number) {
    setQty((q) => ({ ...q, [productId]: Math.max(0, Math.min(99999, Math.round(value) || 0)) }));
  }

  const allText = data
    ? data.suppliers
        .map((g) => purchaseText(g.supplier_name, linesOf(g)))
        .filter((t) => t.includes('\n'))
        .join('\n\n')
    : '';

  return (
    <div className="page">
      <PageHeader
        title="Purchase list"
        description="What to buy, from what is running low."
        actions={
          <button type="button" className="button button--ghost" onClick={() => setReload((n) => n + 1)}>
            Refresh
          </button>
        }
      />

      {data ? <p className="purchase-rule">{data.rule} Change any quantity; 0 leaves the product out.</p> : null}
      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading the purchase list" /> : null}
      {notice ? (
        <p className="purchase-notice" role="status">
          {notice}
        </p>
      ) : null}

      {data && data.items.length === 0 ? <p className="quiet quiet--ok">Nothing is running low. No purchase needed.</p> : null}

      {data && data.items.length > 0 ? (
        <>
          <div className="purchase-total card">
            <p className="card__row">
              <span className="card__label">
                {allLines.filter((l) => l.quantity > 0).length} products · {allLines.reduce((s, l) => s + l.quantity, 0)} units
              </span>
              <span className="card__value">{formatMoney(lineCost(allLines))}</span>
            </p>
            <p className="card__note">Estimated from each product's purchase cost.</p>
            <div className="purchase-actions">
              <button type="button" className="button button--sm" onClick={() => void copy(allText, 'Purchase list')}>
                Copy all
              </button>
              <button
                type="button"
                className="button button--sm"
                onClick={() => downloadBlob(new Blob([purchaseCsv(allLines)], { type: 'text/csv;charset=utf-8' }), 'blynk-purchase-list.csv')}
              >
                Download CSV
              </button>
            </div>
          </div>

          {data.suppliers.map((g) => {
            const lines = linesOf(g);
            const text = purchaseText(g.supplier_name, lines);
            const name = g.supplier_name ?? 'No supplier yet';
            return (
              <section key={g.supplier_id ?? 'none'} className="section purchase-group" aria-label={name}>
                <div className="purchase-group__head">
                  <h2 className="purchase-group__name">{name}</h2>
                  <span className="purchase-group__cost">{formatMoney(lineCost(lines))}</span>
                </div>
                {g.supplier_id === null ? <p className="cat-row__meta">Never bought from a named supplier. Pick one when sourcing to group it next time.</p> : null}
                <ul className="cat-list">
                  {lines.map(({ item, quantity }) => (
                    <li key={item.product_id} className={quantity === 0 ? 'cat-row cat-row--flat is-muted' : 'cat-row cat-row--flat'}>
                      <div className="cat-row__main">
                        <Link className="cat-row__title purchase-item__name" to={`/catalog/inventory/stock/${item.product_id}`}>
                          {lineName(item)}
                        </Link>
                        <p className="cat-row__meta">
                          <span className={`stock stock--${item.stock_state.toLowerCase()}`}>
                            <span className="stock__word">{item.stock_state === 'OUT' ? 'Out' : 'Low'}</span>
                            <span className="stock__units">{item.quantity_available} left</span>
                          </span>{' '}
                          Low at ≤ {item.low_stock_threshold} · target {item.target_level}
                        </p>
                        <p className="cat-row__meta">
                          {formatMoney(item.unit_cost)} each · {formatMoney(item.unit_cost * quantity)}
                        </p>
                      </div>
                      <div className="cat-row__actions">
                        <div className="qty-stepper" role="group" aria-label={`Quantity of ${item.product_name}`}>
                          <button type="button" className="qty-stepper__button" aria-label={`Less ${item.product_name}`} disabled={quantity === 0} onClick={() => setQuantity(item.product_id, quantity - 1)}>
                            −
                          </button>
                          <input
                            className="qty-stepper__value purchase-qty"
                            inputMode="numeric"
                            aria-label={`${item.product_name} quantity`}
                            value={quantity}
                            onChange={(e) => setQuantity(item.product_id, Number(e.target.value.replace(/\D/g, '')))}
                          />
                          <button type="button" className="qty-stepper__button" aria-label={`More ${item.product_name}`} onClick={() => setQuantity(item.product_id, quantity + 1)}>
                            +
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="purchase-actions">
                  <button type="button" className="button button--sm" onClick={() => void copy(text, `Order for ${name}`)}>
                    Copy
                  </button>
                  <a className="button button--sm purchase-whatsapp" href={whatsappUrl(text, g.supplier_phone)} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                </div>
              </section>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
