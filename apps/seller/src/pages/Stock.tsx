import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sellerApi } from '../api/resources';
import type { SellerProduct } from '../api/types';
import { useSeller } from '../auth/SellerContext';
import { Illustration } from '../components/Illustration';
import { IconBox, IconClock, IconPlus } from '../components/icons';
import { StockRow } from '../components/StockRow';
import { EmptyState, ErrorState, Eyebrow, PageLoading } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { notStockable, stockable } from '../lib/stock';

/**
 * My stock: every approved product with the number Blynk shows customers. The seller types how
 * many they really have and saves (PUT /seller/products/:id/stock); that number becomes the live
 * stock. Products still waiting for Blynk (or not approved) have no stock yet, so no box.
 */
export function Stock() {
  const { canSell } = useSeller();
  const [products, setProducts] = useState<SellerProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProducts(await sellerApi.products());
    } catch (err) {
      setError(errorMessage(err, 'Could not load your products. Please try again.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = products ? stockable(products) : [];
  const waiting = products ? notStockable(products) : [];

  return (
    <section aria-labelledby="stock-title" className="stock">
      <div className="page__head">
        <div className="page__titles">
          <Eyebrow>Your products</Eyebrow>
          <h1 id="stock-title">My stock</h1>
          <p className="muted page__sub">
            Type how many of each product you have, then Save. Customers can order only what is in stock.
          </p>
        </div>
      </div>

      {!canSell && products ? (
        <p className="muted catalogue__blocked">You can change your stock once Blynk has approved your shop.</p>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : products === null ? (
        <PageLoading label="Loading your products" />
      ) : rows.length === 0 ? (
        <EmptyState
          art={<Illustration name="jar" />}
          title="No products to count yet"
          message="Once Blynk approves a product, its stock shows here and you can set the number."
          action={
            canSell ? (
              <Link to="/products/new" className="button button--primary button--cta">
                <IconPlus size={20} /> Add a product
              </Link>
            ) : undefined
          }
        />
      ) : (
        <section className="bezel stock__list rise" aria-labelledby="stock-list-title">
          <div className="bezel__core stock__core">
            <header className="stock__head">
              <span className="stock__badge stock__badge--soft" aria-hidden="true">
                <IconBox size={20} />
              </span>
              <div>
                <h2 id="stock-list-title" className="stock__title">
                  Your stock
                </h2>
                <p className="muted stock__lede">It goes down as customers buy. Add more here when you have more.</p>
              </div>
            </header>
            <ul className="sedits">
              {rows.map((p) => (
                <StockRow key={p.id} product={p} editable={canSell} />
              ))}
            </ul>
          </div>
        </section>
      )}

      {products && rows.length > 0 && waiting.length > 0 ? (
        <p className="muted stock__waiting">
          <IconClock size={16} /> {waiting.length} {waiting.length === 1 ? 'product is' : 'products are'} waiting for Blynk
          to approve. Their stock can be set once they are live.
        </p>
      ) : null}
    </section>
  );
}
