import { useCallback, useEffect, useState } from 'react';
import { sellerApi } from '../api/resources';
import type { SellerProduct } from '../api/types';
import { useSeller } from '../auth/SellerContext';
import { Illustration } from '../components/Illustration';
import { IconBox, IconCheckCircle, IconTruck } from '../components/icons';
import { StockNoteList } from '../components/StockNotes';
import { StockNoteSheet } from '../components/StockNoteSheet';
import { EmptyState, ErrorState, Eyebrow, PageLoading, Spinner } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatNumber } from '../lib/format';
import { isSubmissionOnly } from '../lib/products';
import { onTheWay, useSellerRequest, whenWords } from '../lib/requests';

/** Products a stock note can be for: real products that are live on Blynk. */
export function stockable(products: SellerProduct[]): SellerProduct[] {
  return products.filter((p) => !isSubmissionOnly(p) && p.live);
}

/**
 * Stock: what Blynk holds of each product, and "Send stock to Blynk" notes
 * (how many, which day) with their status. The notes need the seller-requests
 * change on the server; until then this screen shows only the stock counts.
 */
export function Stock() {
  const { canSell } = useSeller();
  const [products, setProducts] = useState<SellerProduct[] | null>(null);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ productId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forcedOff, setForcedOff] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const notes = useSellerRequest(sellerApi.stockNotes, 'Could not load your stock notes. Please try again.');

  const loadProducts = useCallback(async () => {
    setProductsError(null);
    try {
      setProducts(await sellerApi.products());
    } catch (err) {
      setProductsError(errorMessage(err, 'Could not load your products. Please try again.'));
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const notesOn = notes.state !== 'off' && !forcedOff;
  const choices = products ? stockable(products) : [];
  const canSend = canSell && notes.state === 'ready' && !forcedOff && choices.length > 0;
  const coming = notes.state === 'ready' ? onTheWay(notes.data) : new Map<string, { quantity: number; next: string }>();
  const open = notes.state === 'ready' ? notes.data.filter((n) => n.status === 'SENT') : [];
  const earlier = notes.state === 'ready' ? notes.data.filter((n) => n.status !== 'SENT') : [];

  async function afterChange(message: string) {
    setActionError(null);
    setNotice(message);
    await notes.reload();
  }

  return (
    <section aria-labelledby="stock-title" className="stock">
      <div className="page__head">
        <div className="page__titles">
          <Eyebrow>At the Blynk store</Eyebrow>
          <h1 id="stock-title">Stock</h1>
          <p className="muted page__sub">
            What Blynk has of your products{notesOn ? ', and the stock you are bringing in' : ''}.
          </p>
        </div>
        {notesOn && notes.state === 'ready' ? (
          canSend ? (
            <button type="button" className="button button--primary button--cta" onClick={() => setSheet({})}>
              <IconTruck size={20} /> Send stock to Blynk
            </button>
          ) : (
            <button type="button" className="button button--primary" disabled aria-describedby="send-blocked">
              <IconTruck size={20} /> Send stock to Blynk
            </button>
          )
        ) : null}
      </div>
      {notesOn && notes.state === 'ready' && !canSend && products ? (
        <p className="muted catalogue__blocked" id="send-blocked">
          {!canSell
            ? 'You can send stock once Blynk has approved your shop.'
            : 'You can send stock once one of your products is live on Blynk.'}
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
      {info ? (
        <p className="notice notice--info" role="status">
          {info}
        </p>
      ) : null}
      {actionError ? <ErrorState message={actionError} /> : null}

      <div className={`stock__grid${notesOn ? ' stock__grid--split' : ''}`}>
        {notesOn ? (
          <section className="bezel stock__notes rise" aria-labelledby="notes-title">
            <div className="bezel__core stock__core">
              <header className="stock__head">
                <span className="stock__badge" aria-hidden="true">
                  <IconTruck size={20} />
                </span>
                <div>
                  <h2 id="notes-title" className="stock__title">
                    Stock you are bringing
                  </h2>
                  <p className="muted stock__lede">Blynk checks each note off when the goods arrive.</p>
                </div>
              </header>
              {notes.state === 'loading' ? (
                <div className="center-block center-block--tight">
                  <Spinner label="Loading your stock notes" />
                </div>
              ) : notes.state === 'error' ? (
                <ErrorState message={notes.message} onRetry={() => void notes.reload()} />
              ) : notes.state === 'ready' && notes.data.length === 0 ? (
                <EmptyState
                  className="empty--soft"
                  art={<Illustration name="crate" />}
                  title="No stock notes yet"
                  message="Bringing goods to the Blynk store? Send a note first so they know it is coming."
                />
              ) : (
                <>
                  {open.length > 0 ? (
                    <>
                      <p className="stock__group">On its way</p>
                      <StockNoteList notes={open} onChanged={afterChange} onError={setActionError} />
                    </>
                  ) : null}
                  {earlier.length > 0 ? (
                    <>
                      <p className="stock__group">Earlier</p>
                      <StockNoteList notes={earlier} onChanged={afterChange} onError={setActionError} />
                    </>
                  ) : null}
                </>
              )}
            </div>
          </section>
        ) : null}

        <section className="bezel stock__onhand rise" style={{ ['--i' as string]: 1 }} aria-labelledby="onhand-title">
          <div className="bezel__core stock__core">
            <header className="stock__head">
              <span className="stock__badge stock__badge--soft" aria-hidden="true">
                <IconBox size={20} />
              </span>
              <div>
                <h2 id="onhand-title" className="stock__title">
                  Stock at Blynk now
                </h2>
                <p className="muted stock__lede">Counted at the Blynk store. It goes down as customers buy.</p>
              </div>
            </header>
            {productsError ? (
              <ErrorState message={productsError} onRetry={() => void loadProducts()} />
            ) : products === null ? (
              <PageLoading label="Loading your products" />
            ) : choices.length === 0 ? (
              <EmptyState
                className="empty--soft"
                art={<Illustration name="jar" />}
                title="Nothing at Blynk yet"
                message="Once a product is live on Blynk, its stock shows here."
              />
            ) : (
              <ul className="onhand">
                {choices.map((p) => {
                  const way = coming.get(p.id);
                  const low = p.stock_on_hand !== null && p.stock_on_hand <= 5;
                  return (
                    <li key={p.id} className="onhand__row">
                      {p.image_url ? (
                        <img className="onhand__thumb" src={p.image_url} alt="" loading="lazy" />
                      ) : (
                        <span className="onhand__thumb onhand__thumb--none" aria-hidden="true">
                          <Illustration name="jar" />
                        </span>
                      )}
                      <span className="onhand__text">
                        <span className="onhand__name">{p.name}</span>
                        <span className="onhand__sub">
                          {way ? (
                            <span className="tag tag--way">
                              <IconTruck size={14} /> {formatNumber(way.quantity)} coming {whenWords(way.next)}
                            </span>
                          ) : low ? (
                            <span className="tag tag--low">Running low</span>
                          ) : (
                            <span className="muted">{p.pack_size ?? p.unit ?? ''}</span>
                          )}
                        </span>
                      </span>
                      <span className="onhand__count">
                        <strong>{p.stock_on_hand === null ? '-' : formatNumber(p.stock_on_hand)}</strong>
                        <small>{p.stock_on_hand === null ? 'not counted' : 'at Blynk'}</small>
                      </span>
                      {canSend ? (
                        <button
                          type="button"
                          className="button button--ghost button--small onhand__more"
                          onClick={() => setSheet({ productId: p.id })}
                          aria-label={`Bring more ${p.name}`}
                        >
                          <IconTruck size={17} /> Bring more
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {sheet ? (
        <StockNoteSheet
          products={choices}
          productId={sheet.productId}
          onClose={() => setSheet(null)}
          onNotReady={() => {
            setSheet(null);
            setForcedOff(true);
            setInfo('Sending stock notes is not switched on yet. Please try again in a little while.');
          }}
          onSent={(message) => {
            setSheet(null);
            void afterChange(message);
          }}
        />
      ) : null}
    </section>
  );
}
