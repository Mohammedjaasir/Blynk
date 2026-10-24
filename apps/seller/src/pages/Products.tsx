import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { sellerApi } from '../api/resources';
import type { SellerProduct } from '../api/types';
import { useSeller } from '../auth/SellerContext';
import { EmptyState, ErrorState, PageLoading } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatDate, formatNumber, lkr } from '../lib/format';
import { isSubmissionOnly, productState } from '../lib/products';

/** My products: every product and submission with where it stands. */
export function Products() {
  const { canSell, seller, reload } = useSeller();
  const location = useLocation();
  const navigate = useNavigate();
  const [products, setProducts] = useState<SellerProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);

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

  // The notice came with the navigation; clear it so a refresh does not repeat it.
  useEffect(() => {
    if ((location.state as { notice?: string } | null)?.notice) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  async function afterWithdraw() {
    setNotice('Your waiting change was withdrawn.');
    await Promise.all([load(), reload()]);
  }

  return (
    <section aria-labelledby="products-title">
      <div className="page__head">
        <h1 id="products-title">My products</h1>
        {canSell ? (
          <Link to="/products/new" className="button button--primary">
            Add a product
          </Link>
        ) : (
          <button type="button" className="button button--primary" disabled aria-describedby="add-blocked">
            Add a product
          </button>
        )}
      </div>
      {!canSell && seller ? (
        <p className="muted" id="add-blocked">
          You can add products once Blynk has approved your shop.
        </p>
      ) : null}

      {notice ? (
        <p className="notice notice--ok" role="status">
          {notice}
        </p>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : products === null ? (
        <PageLoading label="Loading your products" />
      ) : products.length === 0 ? (
        <EmptyState
          title="No products yet"
          message={
            canSell
              ? 'Add your first product. Blynk will check it and set the price customers pay.'
              : 'Once Blynk approves your shop, your products will show up here.'
          }
          action={
            canSell ? (
              <Link to="/products/new" className="button button--primary">
                Add your first product
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="plist">
          {products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} canSell={canSell} onWithdrawn={afterWithdraw} onError={setError} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductCard({
  product,
  canSell,
  onWithdrawn,
  onError,
}: {
  product: SellerProduct;
  canSell: boolean;
  onWithdrawn(): Promise<void>;
  onError(message: string): void;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = productState(product);
  const submissionOnly = isSubmissionOnly(product);
  const rejected = product.last_rejected && !product.pending ? product.last_rejected : null;
  const priceNow = product.pending ? product.pending.seller_price : product.seller_price;

  async function withdraw() {
    if (!product.pending) return;
    setBusy(true);
    try {
      await sellerApi.withdraw(product.pending.id);
      await onWithdrawn();
    } catch (err) {
      onError(errorMessage(err, 'Could not withdraw the change. Please try again.'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article className="pcard" aria-label={product.name}>
      <div className="pcard__top">
        {product.image_url ? (
          <img className="pcard__img" src={product.image_url} alt="" loading="lazy" />
        ) : (
          <span className="pcard__img pcard__img--none" aria-hidden="true">
            No photo
          </span>
        )}
        <div className="pcard__main">
          <h2 className="pcard__name">{product.name}</h2>
          <p className="muted pcard__meta">
            {[product.category_name, product.pack_size ?? product.unit].filter(Boolean).join(' - ')}
          </p>
          <div className="chips">
            <span className={`chip chip--${state.chip.tone}`}>{state.chip.label}</span>
            {state.extra ? <span className={`chip chip--${state.extra.tone}`}>{state.extra.label}</span> : null}
          </div>
        </div>
      </div>

      <dl className="facts">
        <div>
          <dt>Your price</dt>
          <dd>{lkr(product.seller_price)}</dd>
        </div>
        <div>
          <dt>Customers pay</dt>
          <dd>{product.live && product.selling_price !== null ? lkr(product.selling_price) : 'Blynk sets it'}</dd>
        </div>
        <div>
          <dt>Stock at Blynk</dt>
          <dd>{product.stock_on_hand === null ? 'Not counted' : formatNumber(product.stock_on_hand)}</dd>
        </div>
        <div>
          <dt>Sold</dt>
          <dd>{formatNumber(product.units_sold)}</dd>
        </div>
      </dl>

      {product.pending ? (
        <p className="note note--wait">
          {product.pending.kind === 'EDIT'
            ? `You asked for a change on ${formatDate(product.pending.created_at)} (your new price: ${lkr(priceNow)}). The live product stays as it is until Blynk approves it.`
            : `Sent to Blynk on ${formatDate(product.pending.created_at)}. Blynk will check it and set the customer price.`}
        </p>
      ) : null}
      {rejected ? (
        <p className="note note--bad">
          {rejected.kind === 'EDIT' ? 'Your last change was not approved' : 'Not approved'}
          {rejected.reject_reason ? `: ${rejected.reject_reason}` : '.'}
          {rejected.kind === 'EDIT' ? ' The live product is unchanged.' : ''}
        </p>
      ) : null}

      <div className="pcard__actions">
        {!submissionOnly ? (
          canSell ? (
            <Link to={`/products/${encodeURIComponent(product.id)}/edit`} className="button button--ghost">
              Edit
            </Link>
          ) : (
            <button type="button" className="button button--ghost" disabled>
              Edit
            </button>
          )
        ) : rejected && canSell ? (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => navigate('/products/new', { state: { prefill: product } })}
          >
            Fix and send again
          </button>
        ) : null}
        {product.pending ? (
          confirming ? (
            <span className="confirm">
              <button type="button" className="button button--danger" disabled={busy} onClick={() => void withdraw()}>
                Yes, withdraw it
              </button>
              <button type="button" className="button button--link" disabled={busy} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="button button--link" onClick={() => setConfirming(true)}>
              {product.pending.kind === 'EDIT' ? 'Withdraw waiting change' : 'Withdraw this product'}
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}
