import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { wallet as walletApi, type CustomerWallet, type OrderWallet, type WalletEntry, type WalletRefundKind } from '../api/wallet';
import { errorCode } from '../lib/errors';
import { formatDateTime } from '../lib/inventory';
import { formatMoney, shortNumber } from '../lib/orders';
import { MAX_REASON, groupNumber } from '../lib/referralPoints';
import {
  NOTHING_TO_REFUND,
  REASON_HINT,
  REFUND_KIND_OPTIONS,
  WALLET_KIND_LABEL,
  readRefundForm,
  refundCap,
  signedMoney,
  walletErrorMessage,
  type RefundForm,
  type RefundFormField,
} from '../lib/wallet';
import { Spinner } from './ui';

/**
 * Blynk Wallet pieces for the staff screens (owner, 2026-10-15;
 * docs/api/wallet.md): a ledger list, and an order's "Refund to wallet"
 * panel. Every approved refund goes to the customer's wallet; the server
 * caps each refund so an order is never refunded twice.
 */

/** Ledger rows: date, what it was, amount, order, reason and who added it. */
export function WalletEntryList({ entries, label }: { entries: WalletEntry[]; label: string }) {
  return (
    <ul className="cat-list" aria-label={label}>
      {entries.map((e) => (
        <li key={e.id} className="cat-row cat-row--flat">
          <div className="cat-row__main">
            <p className="cat-row__title">{WALLET_KIND_LABEL[e.kind] ?? e.kind}</p>
            <p className="cat-row__meta wallet-entry__wrap">
              {formatDateTime(e.created_at)}
              {e.order_number ? (
                <>
                  {' · '}
                  {e.order_id ? (
                    <Link className="link" to={`/orders/${e.order_id}`}>
                      Order #{shortNumber(e.order_number)}
                    </Link>
                  ) : (
                    `Order #${shortNumber(e.order_number)}`
                  )}
                </>
              ) : null}
              {e.created_by_name ? ` · by ${e.created_by_name}` : ''}
            </p>
            {e.reason ? <p className="cat-row__meta wallet-entry__wrap">{e.reason}</p> : null}
            {e.expires_at ? <p className="cat-row__meta">Expires {formatDateTime(e.expires_at)}</p> : null}
          </div>
          <div className="map-busiest__figures">
            <span className="map-busiest__orders mono">{signedMoney(e.amount)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Codes after which the panel's figures are out of date and are read again. */
const STALE = new Set(['NOTHING_TO_REFUND', 'REFUND_EXCEEDS_REFUNDABLE', 'REFUND_EXCEEDS_DELIVERY_FEE', 'POINTS_RETURN_EXCEEDS']);

/**
 * An order's wallet: what was paid and how, what went back already, what is
 * left to refund, and "Refund to wallet" for a missing / damaged / wrong item
 * or the delivery fee.
 */
export function OrderWalletRefund({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await walletApi.order(orderId));
      setError(null);
    } catch (err) {
      setError(walletErrorMessage(err));
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refundable = data ? Math.max(0, data.refundable) : 0;

  return (
    <section className="order-detail__section order-wallet" aria-label="Blynk Wallet refund" data-testid="order-wallet">
      <h2 className="order-detail__label">Blynk Wallet</h2>
      {error && !data ? (
        <>
          <p className="field__error">{error}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => void load()}>
            Try again
          </button>
        </>
      ) : !data ? (
        <Spinner label="Loading the wallet" />
      ) : (
        <>
          <dl className="order-bill" aria-label="Paid and refunded">
            {data.paid.wallet > 0 ? <Row label="Paid by wallet" value={data.paid.wallet} /> : null}
            {data.paid.online > 0 ? <Row label="Paid online" value={data.paid.online} /> : null}
            {data.paid.cash > 0 ? <Row label="Cash collected" value={data.paid.cash} /> : null}
            <Row label="Paid in all" value={data.paid.total} />
            <Row label="Refunded to wallet so far" value={data.refunded_total} />
            <div className="order-bill__row order-bill__row--total" data-testid="wallet-refundable">
              <dt>Left to refund</dt>
              <dd className="mono">{formatMoney(refundable)}</dd>
            </div>
            <Row label="Delivery fee left to refund" value={Math.max(0, data.delivery_fee_refundable)} />
          </dl>
          {data.points.redeemed > 0 || data.points.earned > 0 ? (
            <p className="order-detail__meta">
              Blynk Points: {groupNumber(data.points.redeemed)} used · {groupNumber(data.points.earned)} earned
              {data.points.returnable > 0 ? ` · ${groupNumber(data.points.returnable)} can be given back` : ''}
            </p>
          ) : null}
          {notice ? (
            <p className="quiet quiet--ok" role="status">
              {notice}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--ghost"
            disabled={refundable <= 0}
            onClick={() => {
              setNotice(null);
              setOpen(true);
            }}
          >
            {refundable > 0 ? 'Refund to wallet' : NOTHING_TO_REFUND}
          </button>
          {data.entries.length > 0 ? <WalletEntryList entries={data.entries} label="Wallet history for this order" /> : null}
          <Link className="link" to={`/more/customers/${data.customer_id}`}>
            Customer's wallet and history
          </Link>
        </>
      )}
      {open && data ? (
        <RefundDialog
          orderId={orderId}
          data={data}
          onClose={() => setOpen(false)}
          onStale={() => void load()}
          onDone={(next, text) => {
            setData(next);
            setNotice(text);
            setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="order-bill__row">
      <dt>{label}</dt>
      <dd className="mono">{formatMoney(value)}</dd>
    </div>
  );
}

function RefundDialog({
  orderId,
  data,
  onClose,
  onStale,
  onDone,
}: {
  orderId: string;
  data: OrderWallet;
  onClose(): void;
  onStale(): void;
  onDone(next: OrderWallet, notice: string): void;
}) {
  const titleId = useId();
  const [form, setForm] = useState<RefundForm>({ kind: 'REFUND_ITEM', amount: '', reason: '', points: '' });
  const [error, setError] = useState<{ message: string; field?: RefundFormField } | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const returnable = Math.max(0, Math.floor(data.points.returnable));
  const cap = refundCap(form.kind, data);

  const change = (patch: Partial<RefundForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const read = readRefundForm(form, data);
    if ('error' in read) {
      setError({ message: read.error, field: read.field });
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const result = await walletApi.refund(orderId, read.value);
      const parts = [`${formatMoney(result.refund.amount)} added to the customer's Blynk Wallet.`];
      if (result.points_returned > 0) parts.push(`${groupNumber(result.points_returned)} Blynk Points given back.`);
      if (result.points_removed > 0) parts.push(`${groupNumber(result.points_removed)} points earned on it taken back.`);
      onDone(result.wallet, parts.join(' '));
    } catch (err) {
      setError({ message: walletErrorMessage(err) });
      const code = errorCode(err);
      if (code && STALE.has(code)) onStale();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title" id={titleId}>
          Refund to wallet · #{shortNumber(data.order_number)}
        </h2>
        <p className="modal__message">
          The money goes to the customer's Blynk Wallet and pays for their next orders. Left to refund: {formatMoney(Math.max(0, data.refundable))}.
        </p>

        <fieldset className="choice">
          <legend className="field__label">What is being refunded</legend>
          {REFUND_KIND_OPTIONS.map((o) => {
            const kindCap = refundCap(o.kind, data);
            return (
              <label key={o.kind} className={`choice__option${form.kind === o.kind ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="wallet-refund-kind"
                  value={o.kind}
                  checked={form.kind === o.kind}
                  // Nothing of this kind left to refund (e.g. the fee was already refunded): not offered.
                  disabled={kindCap <= 0}
                  onChange={() => change({ kind: o.kind as WalletRefundKind })}
                />
                <span>
                  <strong>{o.label}</strong>
                  <em>{kindCap > 0 ? `Up to ${formatMoney(kindCap)}` : 'Nothing left to refund'}</em>
                </span>
              </label>
            );
          })}
        </fieldset>

        <label className="field">
          <span className="field__label">Amount (LKR)</span>
          <input
            className="input input--mono"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => change({ amount: e.target.value })}
            aria-invalid={error?.field === 'amount' ? true : undefined}
          />
          <span className="field__hint">At most {formatMoney(cap)}.</span>
        </label>

        <label className="field">
          <span className="field__label">Reason</span>
          <textarea
            className="input"
            rows={2}
            maxLength={MAX_REASON}
            value={form.reason}
            placeholder="Damaged: Kotmale Fresh Milk 1L"
            onChange={(e) => change({ reason: e.target.value })}
            aria-invalid={error?.field === 'reason' ? true : undefined}
          />
          <span className="field__hint">
            {REASON_HINT} 3 to {MAX_REASON} characters.
          </span>
        </label>

        {returnable > 0 ? (
          <label className="field">
            <span className="field__label">Blynk Points to give back (optional)</span>
            <input
              className="input input--mono"
              inputMode="numeric"
              value={form.points}
              onChange={(e) => change({ points: e.target.value })}
              aria-invalid={error?.field === 'points' ? true : undefined}
            />
            <span className="field__hint">Points used on the refunded item, up to {groupNumber(returnable)}.</span>
          </label>
        ) : null}

        {error ? (
          <p className="field__error" role="alert">
            {error.message}
          </p>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy || cap <= 0}>
            {busy ? <Spinner label="Refunding" /> : 'Refund to wallet'}
          </button>
        </div>
      </form>
    </div>
  );
}

const HISTORY_PAGE = 50;

/**
 * A customer's Blynk Wallet: the balance and every ledger row, newest first
 * (`GET /admin/customers/:id/wallet`). Read-only here: manual adjustments are
 * Admin only.
 */
export function CustomerWalletSection({ customerId }: { customerId: string }) {
  const [data, setData] = useState<CustomerWallet | null>(null);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const first = await walletApi.customer(customerId, { page: 1, limit: HISTORY_PAGE });
      setData(first);
      setEntries(first.entries);
      setError(null);
    } catch (err) {
      setError(walletErrorMessage(err));
    }
  }, [customerId]);

  useEffect(() => {
    setData(null);
    setEntries([]);
    void load();
  }, [load]);

  async function more() {
    if (!data) return;
    setLoadingMore(true);
    try {
      const next = await walletApi.customer(customerId, { page: data.pagination.page + 1, limit: HISTORY_PAGE });
      setData(next);
      setEntries((rows) => [...rows, ...next.entries.filter((e) => !rows.some((r) => r.id === e.id))]);
      setError(null);
    } catch (err) {
      setError(walletErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="section" aria-labelledby="customer-wallet" data-testid="customer-wallet">
      <h2 className="section-label" id="customer-wallet">
        Blynk Wallet
      </h2>
      {error && !data ? (
        <>
          <p className="field__error">{error}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => void load()}>
            Try again
          </button>
        </>
      ) : !data ? (
        <Spinner label="Loading the wallet" />
      ) : (
        <>
          <p className="order-detail__strong" data-testid="wallet-balance">
            Balance {formatMoney(data.balance)}
          </p>
          {!data.enabled ? <p className="quiet">The wallet is switched off at checkout; refunds are still added.</p> : null}
          {entries.length === 0 ? (
            <p className="quiet">No wallet history yet.</p>
          ) : (
            <WalletEntryList entries={entries} label="Wallet history" />
          )}
          {error ? <p className="field__error">{error}</p> : null}
          {data.pagination.page < data.pagination.total_pages ? (
            <button type="button" className="button button--ghost" disabled={loadingMore} onClick={() => void more()}>
              {loadingMore ? 'Loading…' : 'Show older'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
