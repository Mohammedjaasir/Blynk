import { useState } from 'react';
import { Link } from 'react-router-dom';
import { stockApi } from '../api/resources';
import type { StockDetail, StockRow, TrackingMode } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/can';
import { ConfirmDialog, LoadError, Spinner, StockStatus, useToast } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { ADJUSTMENT_LABEL, formatDateTime, formatDelta } from '../lib/format';
import { unitsLabel } from '../lib/stock';
import { useLoad } from '../lib/useLoad';
import { AdjustDialog } from './AdjustDialog';
import { CustomerState } from './Stock';

/**
 * One product's stock: the count, its customer state, tracking mode and the
 * most recent ledger entries. Adjusting and changing tracking mode are ADMIN
 * actions; staff see the same panel without them.
 */
export function StockPanel({
  productId,
  row,
  onClose,
  onChanged,
}: {
  productId: string;
  row?: StockRow;
  onClose(): void;
  onChanged(): void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => stockApi.detail(productId), [productId]);
  const [adjusting, setAdjusting] = useState(false);
  const [modeTarget, setModeTarget] = useState<TrackingMode | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  const detail: StockDetail | null = data;
  const tracked = detail?.tracking_mode === 'TRACKED';

  async function changeMode() {
    if (!modeTarget || !detail) return;
    setModeBusy(true);
    setModeError(null);
    try {
      await stockApi.setMode(productId, modeTarget);
      toast.success(`${detail.product_name} is now ${modeTarget}.`);
      setModeTarget(null);
      await reload();
      onChanged();
    } catch (err) {
      setModeError(errorMessage(err));
    } finally {
      setModeBusy(false);
    }
  }

  return (
    <aside className="panel" aria-label="Product stock">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">{detail?.product_name ?? row?.product_name ?? 'Product'}</h2>
          <p className="panel__meta mono">
            {row ? `${row.product_sku} · ${row.product_unit} · ${row.category_name}` : detail?.product_sku}
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="Close product panel" onClick={onClose}>
          ×
        </button>
      </div>

      {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}
      {loading && !detail ? <Spinner label="Loading product stock" /> : null}

      {detail ? (
        <>
          <section className="figure-block" aria-label="Stock count">
            {tracked ? (
              <>
                <p className="figure-block__number mono">{detail.quantity_on_hand}</p>
                <p className="figure-block__caption">units on hand</p>
                <dl className="figure-block__split">
                  <div>
                    <dt>Reserved</dt>
                    <dd className="mono">{detail.quantity_reserved}</dd>
                  </div>
                  <div>
                    <dt>Available</dt>
                    <dd className="mono">{detail.quantity_available}</dd>
                  </div>
                  <div>
                    <dt>Low at</dt>
                    <dd className="mono">≤ {detail.low_stock_threshold}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="figure-block__untracked">
                Not counted. This product is <strong>sourced on order</strong>: nothing is held in stock and
                sourcing never takes from a count.
              </p>
            )}
            <StockStatus row={detail} />
          </section>

          {row ? (
            <section className="panel__section">
              <h3 className="panel__label">Customer · set in Admin</h3>
              <CustomerState row={row} />
            </section>
          ) : null}

          <section className="panel__section">
            <h3 className="panel__label">Tracking</h3>
            <p className="panel__line">
              <span className={`mode mode--${detail.tracking_mode.toLowerCase()}`}>{detail.tracking_mode}</span>
            </p>
            <div className="panel__actions">
              {can(user?.role, 'adjustStock') && tracked ? (
                <button type="button" className="button" onClick={() => setAdjusting(true)}>
                  Adjust stock
                </button>
              ) : null}
              {can(user?.role, 'changeTrackingMode') ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setModeTarget(tracked ? 'UNTRACKED' : 'TRACKED')}
                >
                  {tracked ? 'Stop tracking' : 'Start tracking'}
                </button>
              ) : null}
            </div>
            {!can(user?.role, 'adjustStock') ? (
              <p className="panel__note">Stock adjustments and tracking changes are made by a Blynk admin.</p>
            ) : !tracked ? (
              <p className="panel__note">Start tracking to record restocks, write-offs and counts.</p>
            ) : null}
          </section>

          <section className="panel__section">
            <h3 className="panel__label">Recent ledger</h3>
            {detail.adjustments.length === 0 ? (
              <p className="panel__note">No stock movements recorded for this product.</p>
            ) : (
              <ol className="mini-ledger">
                {detail.adjustments.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <span className="mini-ledger__type">{ADJUSTMENT_LABEL[a.adjustment_type]}</span>
                    <span className={`delta mono ${a.quantity_delta > 0 ? 'delta--up' : 'delta--down'}`}>
                      {formatDelta(a.quantity_delta)}
                    </span>
                    <span className="mono mini-ledger__after">→ {a.new_quantity}</span>
                    <span className="mini-ledger__when">{formatDateTime(a.created_at)}</span>
                  </li>
                ))}
              </ol>
            )}
            <Link className="text-link" to={`/ledger?product=${productId}`}>
              Full history in the ledger →
            </Link>
          </section>
        </>
      ) : null}

      {adjusting && detail ? (
        <AdjustDialog
          detail={detail}
          onClose={() => setAdjusting(false)}
          onDone={async () => {
            setAdjusting(false);
            await reload();
            onChanged();
          }}
        />
      ) : null}

      {modeTarget && detail ? (
        <ConfirmDialog
          title={modeTarget === 'TRACKED' ? 'Start tracking stock' : 'Stop tracking stock'}
          confirmLabel={modeTarget === 'TRACKED' ? 'Start tracking' : 'Stop tracking'}
          busy={modeBusy}
          error={modeError}
          onConfirm={() => void changeMode()}
          onCancel={() => {
            setModeTarget(null);
            setModeError(null);
          }}
        >
          {modeTarget === 'TRACKED' ? (
            <p>
              <strong>{detail.product_name}</strong> will be counted from its last recorded quantity (
              {unitsLabel(detail.quantity_on_hand)}). Sourcing an order for a tracked product takes from this count, and
              cancelling that order puts it back. The count stops at zero - record a restock before orders need it.
            </p>
          ) : (
            <p>
              <strong>{detail.product_name}</strong> will go back to being sourced on order. The last count (
              {unitsLabel(detail.quantity_on_hand)}) is kept but no longer used, and sourcing stops taking stock. Units
              already taken for an order still come back to this count if that order is cancelled.
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </aside>
  );
}
