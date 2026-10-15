import { useEffect, useState, type FormEvent } from 'react';
import { wallet, type OrderWallet, type WalletRefundKind } from '../api/wallet';
import { formatDay } from '../lib/coupons';
import { formatClock } from '../lib/orders';
import { MAX_REASON, groupNumber, lkr, parseReason } from '../lib/referralPoints';
import {
  WALLET_REFUND_KINDS,
  WALLET_REFUND_KIND_LABEL,
  parseReturnPoints,
  parseWalletRefund,
  signedLkr,
  walletErrorMessage,
  walletKindLabel,
} from '../lib/wallet';
import { Field, Spinner } from './ui';
import './wallet.css';

type FieldName = 'amount' | 'reason' | 'points';

/**
 * Order -> "Refund to wallet" (owner, 2026-10-15; docs/api/wallet.md): what
 * the order paid (wallet, online, cash), what is already back in the wallet,
 * what is still refundable, and a refund for a missing / damaged / wrong item
 * or the delivery fee. Loads only when opened. Never uses the toast so it
 * also works in panels rendered without a ToastProvider.
 */
export function OrderWalletRefund({ orderId, onRefunded }: { orderId: string; onRefunded?(): void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OrderWallet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<WalletRefundKind>('REFUND_ITEM');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [points, setPoints] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setData(null);
    setLoadError(null);
    wallet
      .orderWallet(orderId)
      .then((d) => {
        if (cancelled) return;
        if (!d || typeof d.refundable !== 'number' || !d.paid) {
          setLoadError('Could not load the wallet for this order.');
          return;
        }
        setData(d);
      })
      .catch((err) => !cancelled && setLoadError(walletErrorMessage(err, 'Could not load the wallet for this order.')));
    return () => {
      cancelled = true;
    };
  }, [orderId, open]);

  // A new order in the same panel starts closed.
  useEffect(() => {
    setOpen(false);
    setDone(null);
  }, [orderId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setSaveError(null);
    setDone(null);
    const returnable = data.points?.returnable ?? 0;
    const a = parseWalletRefund(amount, {
      kind,
      refundable: data.refundable,
      deliveryFeeRefundable: data.delivery_fee_refundable,
    });
    const r = parseReason(reason);
    const p = returnable > 0 ? parseReturnPoints(points, returnable) : ({ value: 0 } as const);
    const next: Partial<Record<FieldName, string>> = {};
    if ('error' in a) next.amount = a.error;
    if ('error' in r) next.reason = r.error;
    if ('error' in p) next.points = p.error;
    setErrors(next);
    if ('error' in a || 'error' in r || 'error' in p) return;
    setSaving(true);
    try {
      const result = await wallet.refund(orderId, {
        amount: a.value,
        kind,
        reason: r.value,
        ...(p.value > 0 ? { return_points: p.value } : {}),
      });
      if (result?.wallet && typeof result.wallet.refundable === 'number') {
        setData(result.wallet);
        if (!(result.wallet.delivery_fee_refundable > 0)) setKind('REFUND_ITEM');
      }
      setAmount('');
      setReason('');
      setPoints('');
      const extras = [
        result?.points_returned ? `${groupNumber(result.points_returned)} points given back` : null,
        result?.points_removed ? `${groupNumber(result.points_removed)} earned points removed` : null,
      ].filter(Boolean);
      setDone(`${lkr(a.value)} added to the customer's Blynk Wallet.${extras.length ? ` ${extras.join('; ')}.` : ''}`);
      onRefunded?.();
    } catch (err) {
      setSaveError(walletErrorMessage(err, 'Could not refund to the wallet.'));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="wallet-refund">
        <button type="button" className="button button--ghost button--sm" onClick={() => setOpen(true)}>
          Refund to wallet
        </button>
      </div>
    );
  }

  const nothingLeft = data ? !(data.refundable > 0) : false;
  const feeLeft = data ? data.delivery_fee_refundable > 0 : false;
  const returnable = data?.points?.returnable ?? 0;

  return (
    <section className="wallet-refund" aria-label="Refund to wallet">
      <div className="wallet-refund__head">
        <h3 className="order-panel__label">Refund to wallet</h3>
        <button type="button" className="button button--ghost button--sm" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !data ? (
        <Spinner label="Loading the order's wallet" />
      ) : (
        <>
          <dl className="pay-details" aria-label="Paid and refunded">
            <dt>Paid by wallet</dt>
            <dd className="mono">{lkr(data.paid.wallet)}</dd>
            <dt>Paid online</dt>
            <dd className="mono">{lkr(data.paid.online)}</dd>
            <dt>Cash collected</dt>
            <dd className="mono">{lkr(data.paid.cash)}</dd>
            <dt>Total paid</dt>
            <dd className="mono">{lkr(data.paid.total)}</dd>
            <dt>Refunded so far</dt>
            <dd className="mono">{lkr(data.refunded_total)}</dd>
            <dt>
              <strong>Remaining refundable</strong>
            </dt>
            <dd className="mono" data-testid="wallet-refundable">
              <strong>{lkr(data.refundable)}</strong>
            </dd>
            <dt>Delivery fee refundable</dt>
            <dd className="mono">{lkr(data.delivery_fee_refundable)}</dd>
            {data.points && (data.points.redeemed > 0 || data.points.earned > 0) ? (
              <>
                <dt>Blynk Points</dt>
                <dd>
                  {groupNumber(data.points.redeemed)} used · {groupNumber(data.points.returnable)} can be given back ·{' '}
                  {groupNumber(data.points.earned)} earned
                </dd>
              </>
            ) : null}
          </dl>

          {data.entries.length > 0 ? (
            <div className="table-wrap">
              <table className="table" aria-label="Refunds on this order">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Kind</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Reason</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td className="cell__secondary">
                        {formatDay(e.created_at)} {formatClock(e.created_at)}
                      </td>
                      <td>{walletKindLabel(e.kind)}</td>
                      <td className="num mono">{signedLkr(e.amount)}</td>
                      <td>{e.reason ?? <span className="cell__secondary">—</span>}</td>
                      <td className="cell__secondary">{e.created_by_name ?? 'Blynk'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="form__note">No refunds on this order yet.</p>
          )}

          {nothingLeft ? (
            <p className="form__note" role="status" data-testid="wallet-nothing-left">
              Nothing left to refund
            </p>
          ) : null}

          <form className="form" onSubmit={submit} noValidate aria-label="Refund to wallet form">
            <fieldset className="wallet-refund__fieldset" disabled={nothingLeft || saving}>
              <fieldset className="field wallet-refund__fieldset">
                <legend className="field__label">What is refunded</legend>
                {WALLET_REFUND_KINDS.map((k) => (
                  <label key={k} className="toggle">
                    <input
                      type="radio"
                      name={`wallet-refund-kind-${orderId}`}
                      value={k}
                      checked={kind === k}
                      disabled={k === 'REFUND_DELIVERY_FEE' && !feeLeft}
                      onChange={() => setKind(k)}
                    />
                    <span>
                      {WALLET_REFUND_KIND_LABEL[k]}
                      {k === 'REFUND_DELIVERY_FEE' ? (
                        <em>
                          {feeLeft
                            ? `Up to ${lkr(data.delivery_fee_refundable)} - when the order was wrong or not delivered because of us.`
                            : data.delivery_fee > 0
                              ? 'The delivery fee has already been refunded.'
                              : 'This order had no delivery fee.'}
                        </em>
                      ) : null}
                    </span>
                  </label>
                ))}
              </fieldset>
              <Field
                label="Amount (LKR)"
                hint={`Up to ${lkr(kind === 'REFUND_DELIVERY_FEE' ? Math.min(data.refundable, data.delivery_fee_refundable) : data.refundable)}.`}
                error={errors.amount}
              >
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Reason" hint="The customer sees this reason in their wallet history. 3 to 200 characters." error={errors.reason}>
                <input
                  className="input"
                  maxLength={MAX_REASON}
                  placeholder="Damaged: Milk 1L"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              {returnable > 0 ? (
                <Field
                  label="Points to give back (optional)"
                  hint={`Blynk Points used on the refunded item - up to ${groupNumber(returnable)}. Points earned on it are removed automatically.`}
                  error={errors.points}
                >
                  <input className="input" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />
                </Field>
              ) : null}
            </fieldset>
            {saveError ? (
              <p className="field__error" role="alert">
                {saveError}
              </p>
            ) : null}
            {done ? (
              <p className="form__note" role="status" data-testid="wallet-refund-done">
                {done}
              </p>
            ) : null}
            <div className="form__actions">
              <button type="submit" className="button" disabled={nothingLeft || saving}>
                {saving ? <Spinner label="Saving" /> : 'Refund to wallet'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
