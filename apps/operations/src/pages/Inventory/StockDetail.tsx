import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { inventory as inventoryApi } from '../../api/resources';
import type { StockDetail as StockDetailType, TrackingMode } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { useLowStock } from '../../components/LowStock';
import { Spinner } from '../../components/ui';
import {
  ADJUSTMENT_LABEL,
  formatDateTime,
  formatDelta,
  inventoryErrorMessage,
  isInventoryError,
  stockState,
  unitsLabel,
} from '../../lib/inventory';
import { AdjustDialog } from './AdjustDialog';

/**
 * One product's stock (task F6, plan §13) - the count, its customer state
 * (read-only; owned by Catalog/Admin), tracking mode and the most recent
 * ledger entries. Ported from `apps/inventory/src/pages/StockPanel.tsx` as a
 * full-page route (`/catalog/inventory/stock/:productId`) rather than
 * Inventory's side `<aside>` panel - the same departure F3 made for the
 * Orders board's detail (`OrderDetail.tsx`) and for the same reason (F1's
 * single-column, bottom-tab `Layout` has no spare width for a side panel).
 *
 * Every number here is exactly what the backend returned; adjusting stock
 * or changing tracking mode never predicts the resulting figure beyond the
 * dialog's own labelled preview (common.md rule 8 / this task's brief).
 */
export function StockDetail() {
  const { productId = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<StockDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [modeTarget, setModeTarget] = useState<TrackingMode | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
  const [thresholdBusy, setThresholdBusy] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const { refresh: refreshLowStock } = useLowStock();

  const load = useCallback(async () => {
    try {
      setDetail(await inventoryApi.stock.detail(productId));
      setError(null);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'Could not load this product.'));
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveThreshold(event: FormEvent) {
    event.preventDefault();
    if (thresholdDraft === null || !detail) return;
    const value = thresholdDraft.trim();
    if (!/^\d+$/.test(value) || Number(value) > 100000) {
      setThresholdError('Enter a whole number from 0 to 100000.');
      return;
    }
    setThresholdBusy(true);
    setThresholdError(null);
    try {
      await inventoryApi.stock.setThreshold(productId, Number(value));
      setNotice(`${detail.product_name} now counts as low at ${value} or fewer.`);
      setThresholdDraft(null);
      await load();
      void refreshLowStock();
    } catch (err) {
      if (isInventoryError(err, 'PRODUCT_NOT_TRACKED')) {
        setThresholdError('This product is not tracked, so it has no low-stock level. Start tracking it first.');
        await load();
      } else {
        setThresholdError(inventoryErrorMessage(err));
      }
    } finally {
      setThresholdBusy(false);
    }
  }

  async function changeMode() {
    if (!modeTarget || !detail) return;
    setModeBusy(true);
    setModeError(null);
    try {
      await inventoryApi.stock.setMode(productId, modeTarget);
      setNotice(`${detail.product_name} is now ${modeTarget}.`);
      setModeTarget(null);
      await load();
      void refreshLowStock();
    } catch (err) {
      setModeError(inventoryErrorMessage(err));
    } finally {
      setModeBusy(false);
    }
  }

  if (error && !detail) {
    return (
      <div className="page">
        <PageHeader title="Product stock" />
        <p className="field__error">{error}</p>
        <button type="button" className="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page">
        <PageHeader title="Product stock" />
        <Spinner label="Loading product stock" />
      </div>
    );
  }

  const tracked = detail.tracking_mode === 'TRACKED';
  const state = stockState(detail);

  return (
    <div className="page">
      <PageHeader
        title={detail.product_name}
        description={detail.product_sku ? `SKU ${detail.product_sku}` : undefined}
        actions={
          <button type="button" className="button button--ghost" onClick={() => navigate(-1)}>
            Back
          </button>
        }
      />

      {notice ? <p className="field__error" role="status">{notice}</p> : null}

      <div className="card">
        {tracked ? (
          <>
            <p className="card__row">
              <span className="card__label">On hand</span>
              <span className="card__value mono">{detail.quantity_on_hand}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Reserved</span>
              <span className="card__value mono">{detail.quantity_reserved}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Available</span>
              <span className="card__value mono">{detail.quantity_available}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Low at</span>
              <span className="card__value mono">
                ≤ {detail.low_stock_threshold}
                {thresholdDraft === null ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setThresholdDraft(String(detail.low_stock_threshold));
                      setThresholdError(null);
                    }}
                  >
                    Change
                  </button>
                ) : null}
              </span>
            </p>
            {thresholdDraft !== null ? (
              <form className="fee-form" onSubmit={(e) => void saveThreshold(e)} noValidate>
                <label className="field">
                  <span className="field__label">Low-stock level</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={thresholdDraft}
                    onChange={(e) => setThresholdDraft(e.target.value)}
                  />
                </label>
                <button type="submit" className="button" disabled={thresholdBusy}>
                  {thresholdBusy ? <Spinner label="Saving" /> : 'Save level'}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setThresholdDraft(null);
                    setThresholdError(null);
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <p className="card__note">
            Not counted. This product is <strong>sourced on order</strong>: nothing is held in stock and packing
            never takes from a count.
          </p>
        )}
        {thresholdError ? <p className="field__error" role="alert">{thresholdError}</p> : null}
        <span className={`stock stock--${state.kind.toLowerCase()}`}>
          <span className="stock__word">{state.label}</span>
          {state.units !== null ? <span className="stock__units">{unitsLabel(state.units)}</span> : null}
        </span>
      </div>

      <section className="section">
        <h2 className="section-label">Tracking</h2>
        <p className="card__note mono">{detail.tracking_mode}</p>
        <div className="actions-row">
          {tracked ? (
            <button type="button" className="button" onClick={() => setAdjusting(true)}>
              Adjust stock
            </button>
          ) : null}
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setModeTarget(tracked ? 'UNTRACKED' : 'TRACKED')}
          >
            {tracked ? 'Stop tracking' : 'Start tracking'}
          </button>
        </div>
      </section>

      <section className="section">
        <h2 className="section-label">Recent ledger</h2>
        {detail.adjustments.length === 0 ? (
          <p className="quiet">No stock movements recorded for this product.</p>
        ) : (
          <ul className="cat-list">
            {detail.adjustments.slice(0, 8).map((a) => (
              <li key={a.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">{ADJUSTMENT_LABEL[a.adjustment_type]}</p>
                  <p className="cat-row__meta">{formatDateTime(a.created_at)}</p>
                </div>
                <div className="cat-row__actions">
                  <span className={`delta mono ${a.quantity_delta > 0 ? 'delta--up' : 'delta--down'}`}>
                    {formatDelta(a.quantity_delta)}
                  </span>
                  <span className="mono">→ {a.new_quantity}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link className="text-button" to={`/catalog/inventory/ledger?product=${productId}`}>
          Full history in the ledger →
        </Link>
      </section>

      {adjusting ? (
        <AdjustDialog
          detail={detail}
          onClose={() => setAdjusting(false)}
          onDone={async () => {
            setAdjusting(false);
            await load();
            void refreshLowStock();
          }}
        />
      ) : null}

      {modeTarget ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Change tracking mode">
          <div className="modal__panel">
            <h2 className="modal__title">{modeTarget === 'TRACKED' ? 'Start tracking stock' : 'Stop tracking stock'}</h2>
            <div className="modal__body">
              {modeTarget === 'TRACKED' ? (
                <p>
                  <strong>{detail.product_name}</strong> will be counted from its last recorded quantity (
                  {unitsLabel(detail.quantity_on_hand)}). Packing an order for a tracked product takes from this
                  count, and cancelling that order puts it back. The count stops at zero - record a restock before
                  orders need it.
                </p>
              ) : (
                <p>
                  <strong>{detail.product_name}</strong> will go back to being sourced on order. The last count (
                  {unitsLabel(detail.quantity_on_hand)}) is kept but no longer used, and packing stops taking stock.
                  Units already taken for an order still come back to this count if that order is cancelled.
                </p>
              )}
            </div>
            {modeError ? <p className="field__error">{modeError}</p> : null}
            <div className="modal__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setModeTarget(null);
                  setModeError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="button" onClick={() => void changeMode()} disabled={modeBusy}>
                {modeBusy ? <Spinner label="Working" /> : modeTarget === 'TRACKED' ? 'Start tracking' : 'Stop tracking'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
