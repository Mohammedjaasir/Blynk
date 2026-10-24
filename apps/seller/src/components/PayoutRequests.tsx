import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { sellerApi } from '../api/resources';
import type { PayoutMethod, PayoutRequest } from '../api/types';
import { fieldErrors } from '../lib/apiErrors';
import { formatDate, lkr, parsePrice } from '../lib/format';
import {
  AMOUNT_OVER_DUE_MESSAGE,
  METHOD_LABEL,
  isRequestsNotReady,
  payoutChip,
  requestMessage,
} from '../lib/requests';
import { IconBank, IconCash, IconClock } from './icons';
import { Sheet } from './Sheet';
import { ButtonArrow, Field, Spinner, describedBy } from './ui';

const BANK_MAX = 300;
const NOTE_MAX = 500;

type Errors = Partial<Record<'amount' | 'bank_details' | 'note', string>>;

/** Money typed as "3000" or "3,000.50" shown back without "LKR". */
function plainAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * "Ask for payment": how much (the amount due, or less), how (bank transfer with
 * the account details, or cash at the Blynk store) and a note. One open request
 * at a time (409 PAYOUT_REQUEST_OPEN); never more than is due (400 AMOUNT_OVER_DUE).
 */
export function AskPaymentSheet({
  due,
  lastBankDetails,
  onClose,
  onSent,
  onAlreadyOpen,
  onNotReady,
}: {
  due: number;
  /** The account details from the last bank request, so they need not be typed again. */
  lastBankDetails: string | null;
  onClose(): void;
  onSent(message: string): void;
  /** The server already has an open request: refresh the list. */
  onAlreadyOpen(): void;
  onNotReady(): void;
}) {
  const [amount, setAmount] = useState(due > 0 ? plainAmount(due) : '');
  const [method, setMethod] = useState<PayoutMethod>(lastBankDetails ? 'BANK' : 'CASH');
  const [bank, setBank] = useState(lastBankDetails ?? '');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function check(): Errors {
    const found: Errors = {};
    const value = parsePrice(amount);
    if (value === null || value <= 0) found.amount = 'Enter the amount, like 2500.';
    else if (value > due + 0.001) found.amount = `That is more than Blynk owes you (${lkr(due)}).`;
    if (method === 'BANK') {
      if (bank.trim().length < 6) found.bank_details = 'Add your bank, branch, account name and account number.';
      else if (bank.trim().length > BANK_MAX) found.bank_details = `Too long (${BANK_MAX} letters at most).`;
    }
    if (note.trim().length > NOTE_MAX) found.note = `The note is too long (${NOTE_MAX} letters at most).`;
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    const value = parsePrice(amount)!;
    setBusy(true);
    try {
      await sellerApi.askForPayment({
        amount: value,
        method,
        ...(method === 'BANK' ? { bank_details: bank.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSent(
        method === 'BANK'
          ? `Sent. Blynk will transfer ${lkr(value)} to your bank and mark it paid here.`
          : `Sent. Collect ${lkr(value)} in cash at the Blynk store - it shows here once paid.`
      );
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'AMOUNT_OVER_DUE') {
        setErrors({ amount: AMOUNT_OVER_DUE_MESSAGE });
        return;
      }
      const server = fieldErrors(err);
      const mapped: Errors = {};
      for (const key of ['amount', 'bank_details', 'note'] as const) {
        if (server[key]) mapped[key] = server[key];
      }
      setErrors(mapped);
      setFormError(
        Object.keys(mapped).length > 0
          ? 'Please fix the highlighted boxes.'
          : requestMessage(err, 'Could not send your request. Please try again.')
      );
      if (err instanceof ApiError && err.code === 'PAYOUT_REQUEST_OPEN') onAlreadyOpen();
      if (isRequestsNotReady(err)) onNotReady();
    }
  }

  return (
    <Sheet
      eyebrow="Your money"
      title="Ask for payment"
      lede={
        <>
          Blynk owes you <strong>{lkr(due)}</strong>. Ask for all of it or a part.
        </>
      }
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} noValidate className="payform">
        <Field id="pr-amount" label="Amount" required hideOptional error={errors.amount}>
          <div className="input-affix input-affix--text payform__amount">
            <span className="input-affix__prefix" aria-hidden="true">
              LKR
            </span>
            <input
              id="pr-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={describedBy('pr-amount', false, errors.amount)}
            />
          </div>
          {parsePrice(amount) !== due && due > 0 ? (
            <button type="button" className="button button--link payform__all" onClick={() => setAmount(plainAmount(due))}>
              Ask for all of it ({lkr(due)})
            </button>
          ) : null}
        </Field>

        <fieldset className="field payform__methods">
          <legend className="field__label">How should Blynk pay you?</legend>
          <div className="methods">
            {(['BANK', 'CASH'] as const).map((m) => (
              <label key={m} className={`method${method === m ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="pr-method"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                  className="method__radio"
                />
                <span className="method__icon" aria-hidden="true">
                  {m === 'BANK' ? <IconBank size={22} /> : <IconCash size={22} />}
                </span>
                <span className="method__text">
                  <strong>{METHOD_LABEL[m]}</strong>
                  <span>{m === 'BANK' ? 'To your bank account' : 'Collect it at the Blynk store'}</span>
                </span>
                <span className="method__tick" aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>

        {method === 'BANK' ? (
          <Field
            id="pr-bank"
            label="Your bank details"
            required
            error={errors.bank_details}
            hint="Bank, branch, account name and account number."
          >
            <textarea
              id="pr-bank"
              rows={3}
              maxLength={BANK_MAX}
              placeholder={'Bank of Ceylon, Aluthgama\nM. Nimal\n0012345678'}
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              aria-invalid={Boolean(errors.bank_details)}
              aria-describedby={describedBy('pr-bank', true, errors.bank_details)}
            />
          </Field>
        ) : null}

        <Field id="pr-note" label="Note for Blynk" error={errors.note}>
          <textarea
            id="pr-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={describedBy('pr-note', false, errors.note)}
          />
        </Field>

        {formError ? (
          <p className="notice notice--bad" role="alert">
            {formError}
          </p>
        ) : null}

        <button type="submit" className="button button--primary button--block button--cta" disabled={busy}>
          {busy ? <Spinner label="Sending" /> : null} Send my request
          <ButtonArrow />
        </button>
      </form>
    </Sheet>
  );
}

/** The open request (with Withdraw) and the earlier requests. */
export function PayoutRequestsPanel({
  requests,
  onWithdrawn,
  onError,
}: {
  requests: PayoutRequest[];
  onWithdrawn(message: string): Promise<void> | void;
  onError(message: string): void;
}) {
  const open = requests.find((r) => r.status === 'REQUESTED') ?? null;
  const history = requests.filter((r) => r !== open);
  if (!open && history.length === 0) return null;

  return (
    <section className="payreq" aria-label="Your payment requests">
      {open ? <OpenRequest request={open} onWithdrawn={onWithdrawn} onError={onError} /> : null}
      {history.length > 0 ? (
        <div className="ledger payreq__history">
          <h2 className="ledger__title">
            <IconClock size={20} /> Your payment requests
          </h2>
          <ul className="lines">
            {history.map((r) => {
              const chip = payoutChip(r);
              return (
                <li key={r.id} className="line line--req" aria-label={`${lkr(r.amount)}, ${chip.label}`}>
                  <span className="line__name">
                    {lkr(r.amount)}
                    <span className={`chip chip--${chip.tone} chip--small`}>
                      <span className="chip__dot" aria-hidden="true" />
                      {chip.label}
                    </span>
                  </span>
                  <span className="line__units">
                    {METHOD_LABEL[r.method]} · asked {formatDate(r.created_at)}
                    {r.handled_at && r.status === 'PAID' ? ` · paid ${formatDate(r.handled_at)}` : ''}
                    {r.status === 'DECLINED' && r.decline_reason ? (
                      <span className="line__reason">Reason: {r.decline_reason}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function OpenRequest({
  request,
  onWithdrawn,
  onError,
}: {
  request: PayoutRequest;
  onWithdrawn(message: string): Promise<void> | void;
  onError(message: string): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    setBusy(true);
    try {
      await sellerApi.withdrawPayoutRequest(request.id);
      await onWithdrawn('Your payment request was withdrawn. You can ask again any time.');
    } catch (err) {
      onError(requestMessage(err, 'Could not withdraw the request. Please try again.'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article className="bezel openreq rise" aria-label="Payment request waiting for Blynk">
      <div className="bezel__core openreq__core">
        <span className="openreq__pulse" aria-hidden="true">
          <IconClock size={22} />
        </span>
        <div className="openreq__body">
          <p className="openreq__kicker">Waiting for Blynk</p>
          <p className="openreq__amount">{lkr(request.amount)}</p>
          <p className="openreq__meta">
            {request.method === 'BANK' ? <IconBank size={16} /> : <IconCash size={16} />} {METHOD_LABEL[request.method]} ·
            asked {formatDate(request.created_at)}
          </p>
          {request.method === 'BANK' && request.bank_details ? (
            <p className="openreq__detail">{request.bank_details}</p>
          ) : null}
          {request.note ? <p className="openreq__detail">“{request.note}”</p> : null}
        </div>
        <div className="openreq__actions">
          {confirming ? (
            <span className="confirm">
              <button type="button" className="button button--danger button--small" disabled={busy} onClick={() => void withdraw()}>
                Yes, withdraw it
              </button>
              <button type="button" className="button button--link" disabled={busy} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="button button--ghost button--small" onClick={() => setConfirming(true)}>
              Withdraw request
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
