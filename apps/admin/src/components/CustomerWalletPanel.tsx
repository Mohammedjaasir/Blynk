import { useEffect, useState, type FormEvent } from 'react';
import { useSignedInUser } from '../auth/AuthContext';
import { wallet, type CustomerWallet } from '../api/wallet';
import { errorMessage } from '../lib/apiErrors';
import { formatDay } from '../lib/coupons';
import { formatClock, shortNumber } from '../lib/orders';
import { MAX_REASON, lkr, parseReason } from '../lib/referralPoints';
import { parseWalletAdjust, signedLkr, walletErrorMessage, walletKindLabel } from '../lib/wallet';
import { EmptyState, Field, Spinner, useToast } from './ui';

const LIMIT = 50;

/**
 * Customers -> one customer -> Blynk Wallet (owner, 2026-10-15;
 * docs/api/wallet.md): the balance and every payment, refund, adjustment and
 * expiry. Only an ADMIN may adjust (+/-, with a reason); the server audits it
 * and refuses to go below 0. `version` is bumped by the page after a refund
 * made elsewhere on it, so the panel re-reads.
 */
export function CustomerWalletPanel({ customerId, version = 0 }: { customerId: string; version?: number }) {
  const toast = useToast();
  // The Customers pages are ADMIN-only routes; outside an AuthProvider (page
  // tests) there is no user, and the route guard is what keeps others out.
  const role = useSignedInUser()?.role;
  const canAdjust = role === undefined || role === 'ADMIN';
  const [data, setData] = useState<CustomerWallet | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    wallet
      .customerWallet(customerId, { page, limit: LIMIT })
      .then((d) => {
        if (cancelled) return;
        // A backend from before the wallet answers something else - say so
        // instead of breaking the customer page.
        if (!d || !Array.isArray(d.entries) || typeof d.balance !== 'number') {
          setLoadError('Could not load the wallet.');
          return;
        }
        setData(d);
        setLoadError(null);
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the wallet.')));
    return () => {
      cancelled = true;
    };
  }, [customerId, page, version]);

  async function adjust(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    const a = parseWalletAdjust(amount);
    const r = parseReason(reason);
    setAmountError('error' in a ? a.error : null);
    setReasonError('error' in r ? r.error : null);
    if ('error' in a || 'error' in r) return;
    setSaving(true);
    try {
      const next = await wallet.adjust(customerId, { amount: a.value, reason: r.value });
      setPage(1);
      setData(next);
      setAmount('');
      setReason('');
      toast.success(`${signedLkr(a.value)} saved to the wallet.`);
    } catch (err) {
      setSaveError(walletErrorMessage(err, 'Could not adjust the wallet.', { balance: data?.balance }));
    } finally {
      setSaving(false);
    }
  }

  const pages = data?.pagination?.total_pages ?? 1;

  return (
    <section className="panel" aria-label="Blynk Wallet">
      <h2 className="panel__title">Blynk Wallet</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !data ? (
        <Spinner label="Loading the wallet" />
      ) : (
        <>
          <div className="figures" aria-label="Wallet figures">
            <div className="figure">
              <span className="figure__value figure__value--sm" data-testid="wallet-balance">
                {lkr(data.balance)}
              </span>
              <span className="figure__label">Balance</span>
            </div>
          </div>
          <p className="form__note">Refunds land here. The balance pays for Blynk orders only - it is never paid out as cash.</p>
          {!data.enabled ? (
            <p className="form__note">The wallet is off in Settings - customers cannot use it at checkout now, but refunds are still credited.</p>
          ) : null}

          {data.entries.length === 0 ? (
            <EmptyState title="No wallet activity yet" />
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="Wallet history">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Kind</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Order</th>
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
                      <td>
                        {walletKindLabel(e.kind)}
                        {e.expires_at && e.amount > 0 ? <span className="cell__secondary"> · expires {formatDay(e.expires_at)}</span> : null}
                      </td>
                      <td className="num mono">{signedLkr(e.amount)}</td>
                      <td className="mono">{e.order_number ? `#${shortNumber(e.order_number)}` : '—'}</td>
                      <td>{e.reason ?? <span className="cell__secondary">—</span>}</td>
                      <td className="cell__secondary">{e.created_by_name ?? (e.kind === 'ADJUSTMENT' ? 'Staff' : 'Blynk')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 ? (
            <nav className="pager" aria-label="Wallet pages">
              <button type="button" className="button button--ghost button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Newer
              </button>
              <span className="cell__secondary">
                Page {page} of {pages}
              </span>
              <button type="button" className="button button--ghost button--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Older
              </button>
            </nav>
          ) : null}

          {canAdjust ? (
            <form className="form" onSubmit={adjust} noValidate aria-label="Adjust the wallet">
              <Field
                label="Adjust wallet (LKR +/-)"
                hint="500 adds LKR 500; -500 takes it away. The balance cannot go below 0. The customer sees “Adjusted by Blynk”."
                error={amountError ?? undefined}
              >
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Reason" hint="Required - kept for staff and the audit log." error={reasonError ?? undefined}>
                <input className="input" maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              {saveError ? (
                <p className="field__error" role="alert">
                  {saveError}
                </p>
              ) : null}
              <div className="form__actions">
                <button type="submit" className="button" disabled={saving}>
                  {saving ? <Spinner label="Saving" /> : 'Adjust wallet'}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
