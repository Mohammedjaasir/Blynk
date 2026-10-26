import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { sellerApi } from '../api/resources';
import type { SellerProduct, Statement } from '../api/types';
import { useSeller } from '../auth/SellerContext';
import { BestSellers } from '../components/BestSellers';
import { Tracker, WelcomeHero } from '../components/Home';
import { Illustration } from '../components/Illustration';
import {
  IconBox,
  IconCheckCircle,
  IconClock,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconWallet,
} from '../components/icons';
import { NotificationsNudge } from '../components/NotificationsCard';
import { EmptyState, ErrorState, Eyebrow, Kpi, PageLoading } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatDate, formatNumber, lkr } from '../lib/format';
import { onboarding } from '../lib/onboarding';
import { isSubmissionOnly, productState } from '../lib/products';

/**
 * My products is the seller's home: a welcome card, the getting-started
 * tracker until the shop is selling, the shop's numbers once approved, and
 * every product and submission with where it stands.
 */
export function Products() {
  const { canSell, seller, reload } = useSeller();
  const location = useLocation();
  const navigate = useNavigate();
  const [products, setProducts] = useState<SellerProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [money, setMoney] = useState<Statement | null | 'failed'>(null);
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

  // "Blynk owes you" for the numbers row: only an approved (or paused) shop has money to show.
  const hasMoney = seller?.status === 'APPROVED' || seller?.status === 'SUSPENDED';
  useEffect(() => {
    if (!hasMoney) return;
    let live = true;
    sellerApi
      .statement()
      .then((s) => live && setMoney(s))
      .catch(() => live && setMoney('failed'));
    return () => {
      live = false;
    };
  }, [hasMoney]);

  // The notice came with the navigation; clear it so a refresh does not repeat it.
  useEffect(() => {
    if ((location.state as { notice?: string } | null)?.notice) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  async function afterWithdraw() {
    setNotice('Your waiting change was withdrawn.');
    await Promise.all([load(), reload()]);
  }

  const live = products?.filter((p) => p.live && p.is_active).length ?? 0;
  const waiting = products?.filter((p) => p.pending).length ?? 0;
  const sold = products?.reduce((sum, p) => sum + (Number(p.units_sold) || 0), 0) ?? 0;

  const steps = seller && (products !== null || error) ? onboarding(seller, products) : null;
  const showTracker = Boolean(steps && !steps.complete && seller?.status !== 'SUSPENDED');
  const showKpis = hasMoney && products !== null && products.length > 0;
  const showBest = seller?.status === 'APPROVED' && products !== null && products.length > 0;
  const kpis = showKpis ? (
    <dl className={`kpis${showTracker ? ' kpis--row' : ''}`} aria-label="Your shop at a glance">
      <Kpi
        tone="ink"
        icon={<IconWallet size={18} />}
        label="Blynk owes you"
        value={money === null ? '...' : money === 'failed' ? '-' : lkr(money.due)}
        hint={money && money !== 'failed' ? `${lkr(money.paid)} of ${lkr(money.earned)} earned is paid` : undefined}
        meter={money && money !== 'failed' && money.earned > 0 ? (money.paid / money.earned) * 100 : undefined}
        index={1}
      />
      <Kpi icon={<IconCheckCircle size={18} />} label="Live" value={formatNumber(live)} hint="On sale now" index={2} />
      <Kpi icon={<IconClock size={18} />} label="Waiting" value={formatNumber(waiting)} hint="With Blynk" index={3} />
      <Kpi icon={<IconBox size={18} />} label="Sold" value={formatNumber(sold)} hint="Units delivered" index={4} />
    </dl>
  ) : null;

  return (
    <section aria-labelledby="products-title" className="home">
      {seller ? (
        <div className={`home__top${showTracker || (kpis && !showTracker) ? ' home__top--split' : ''}`}>
          <WelcomeHero seller={seller} complete={!showTracker} />
          {showTracker && steps ? <Tracker data={steps} /> : kpis}
        </div>
      ) : null}
      {showTracker ? kpis : null}
      <NotificationsNudge />
      {showBest ? <BestSellers /> : null}

      <div className="catalogue">
        <div className="page__head page__head--catalogue">
          <div className="page__titles">
            <Eyebrow>Your catalogue</Eyebrow>
            <h1 id="products-title">My products</h1>
            {products && products.length > 0 ? (
              <p className="muted page__sub">
                {`${live} live on Blynk${waiting ? `, ${waiting} waiting for Blynk to check` : ''}`}
              </p>
            ) : null}
          </div>
          {canSell ? (
            <Link to="/products/new" className="button button--primary button--cta">
              <IconPlus size={20} /> Add a product
            </Link>
          ) : (
            <button type="button" className="button button--primary" disabled aria-describedby="add-blocked">
              <IconPlus size={20} /> Add a product
            </button>
          )}
        </div>
        {!canSell && seller ? (
          <p className="muted catalogue__blocked" id="add-blocked">
            You can add products once Blynk has approved your shop.
          </p>
        ) : null}

        {notice ? (
          <p className="notice notice--ok notice--row" role="status">
            <span className="notice__icon" aria-hidden="true">
              <IconCheckCircle size={20} />
            </span>
            <span className="notice__body">{notice}</span>
          </p>
        ) : null}

        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : products === null ? (
          <PageLoading label="Loading your products" />
        ) : products.length === 0 ? (
          <EmptyState
            art={<Illustration name="crate" />}
            title="No products yet"
            message={
              canSell
                ? 'Add your first product. Blynk will check it and set the price customers pay.'
                : 'Once Blynk approves your shop, your products will show up here - with photos, prices and what sold.'
            }
            action={
              canSell ? (
                <Link to="/products/new" className="button button--primary button--cta">
                  <IconPlus size={20} /> Add your first product
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="plist">
            {products.map((product, index) => (
              <li key={product.id} className="rise" style={{ ['--i' as string]: Math.min(index, 8) }}>
                <ProductCard
                  product={product}
                  canSell={canSell}
                  onWithdrawn={afterWithdraw}
                  onError={setError}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** One of four soft backgrounds for a product without a photo, the same every time for a name. */
function tintOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 4;
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
    <article className={`pcard pcard--${state.chip.tone}`} aria-label={product.name}>
      <div className="pcard__media">
        {product.image_url ? (
          <img className="pcard__img" src={product.image_url} alt="" loading="lazy" />
        ) : (
          <span className={`pcard__img pcard__img--none pcard__img--v${tintOf(product.name)}`} aria-hidden="true">
            <Illustration name="jar" />
          </span>
        )}
        <div className="chips pcard__chips">
          <span className={`chip chip--${state.chip.tone}`}>
            <span className="chip__dot" aria-hidden="true" />
            {state.chip.label}
          </span>
          {state.extra ? (
            <span className={`chip chip--${state.extra.tone}`}>
              <span className="chip__dot" aria-hidden="true" />
              {state.extra.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="pcard__body">
        <h2 className="pcard__name">{product.name}</h2>
        <p className="muted pcard__meta">
          {[product.category_name, product.pack_size ?? product.unit].filter(Boolean).join(' · ')}
        </p>

        <dl className="facts">
          <div className="fact fact--price">
            <dt>Your price</dt>
            <dd>{lkr(product.seller_price)}</dd>
          </div>
          <div className="fact fact--price fact--pay">
            <dt>Customers pay</dt>
            <dd>{product.live && product.selling_price !== null ? lkr(product.selling_price) : 'Blynk sets it'}</dd>
          </div>
          <div className="fact">
            <dt>In stock</dt>
            <dd>{product.stock_on_hand === null ? 'Not counted' : formatNumber(product.stock_on_hand)}</dd>
          </div>
          <div className="fact">
            <dt>Sold</dt>
            <dd>{formatNumber(product.units_sold)}</dd>
          </div>
        </dl>

        {product.pending ? (
          <p className="note note--wait">
            <IconClock size={18} />
            <span>
              {product.pending.kind === 'EDIT'
                ? `You asked for a change on ${formatDate(product.pending.created_at)} (your new price: ${lkr(priceNow)}). The live product stays as it is until Blynk approves it.`
                : `Sent to Blynk on ${formatDate(product.pending.created_at)}. Blynk will check it and set the customer price.`}
            </span>
          </p>
        ) : null}
        {rejected ? (
          <p className="note note--bad">
            <span>
              {rejected.kind === 'EDIT' ? 'Your last change was not approved' : 'Not approved'}
              {rejected.reject_reason ? `: ${rejected.reject_reason}` : '.'}
              {rejected.kind === 'EDIT' ? ' The live product is unchanged.' : ''}
            </span>
          </p>
        ) : null}

        <div className="pcard__actions">
          {!submissionOnly ? (
            canSell ? (
              <Link to={`/products/${encodeURIComponent(product.id)}/edit`} className="button button--ghost button--small">
                <IconPencil size={17} /> Edit
              </Link>
            ) : (
              <button type="button" className="button button--ghost button--small" disabled>
                <IconPencil size={17} /> Edit
              </button>
            )
          ) : rejected && canSell ? (
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => navigate('/products/new', { state: { prefill: product } })}
            >
              <IconRefresh size={17} /> Fix and send again
            </button>
          ) : null}
          {canSell && !submissionOnly && product.live && product.stock_tracked !== false ? (
            <Link to="/stock" className="button button--ghost button--small button--stock">
              <IconBox size={17} /> Update stock
            </Link>
          ) : null}
          {product.pending ? (
            confirming ? (
              <span className="confirm">
                <button type="button" className="button button--danger button--small" disabled={busy} onClick={() => void withdraw()}>
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
      </div>
    </article>
  );
}
