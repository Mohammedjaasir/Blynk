import type { ReactNode } from 'react';
import { OTP_LENGTH, formatCountdown } from '../lib/otp';

/**
 * Pieces shared by sign-in and the rider application: the 6-digit code field
 * with its resend countdown, and the two answers about an application
 * (waiting for approval / not approved).
 */

export function CodeField({
  id,
  value,
  onChange,
  devOtp,
  resendIn,
  resending,
  onResend,
}: {
  id: string;
  value: string;
  onChange(value: string): void;
  devOtp: string | null;
  /** Seconds until another code may be asked for; 0 = now. */
  resendIn: number;
  resending: boolean;
  onResend(): void;
}) {
  return (
    <>
      <label className="field" htmlFor={id}>
        <span className="field__label">6-digit code</span>
        <input
          id={id}
          className="input input--code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ''))}
          required
          autoFocus
        />
      </label>
      {/* The API only returns this outside production. */}
      {devOtp ? <p className="login__dev">Dev code: {devOtp}</p> : null}
      <button
        type="button"
        className="text-button login__resend"
        onClick={onResend}
        disabled={resendIn > 0 || resending}
      >
        {resending ? 'Sending a new code…' : resendIn > 0 ? `Resend code in ${formatCountdown(resendIn)}` : 'Resend code'}
      </button>
    </>
  );
}

export function PendingNotice({ children }: { children?: ReactNode }) {
  return (
    <section className="apply-status" aria-labelledby="apply-status-pending">
      <span className="apply-status__tag">Waiting</span>
      <h1 id="apply-status-pending" className="login__title">
        Waiting for approval
      </h1>
      <p className="apply-status__text" role="status">
        Your application is waiting for approval. We'll send you an SMS when you're approved.
      </p>
      <div className="login__form">{children}</div>
    </section>
  );
}

export function RejectedNotice({ reason, children }: { reason: string | null; children?: ReactNode }) {
  return (
    <section className="apply-status" aria-labelledby="apply-status-rejected">
      <span className="apply-status__tag apply-status__tag--stop">Not approved</span>
      <h1 id="apply-status-rejected" className="login__title">
        Your application wasn't approved.
      </h1>
      <p className="apply-status__text" role="status">
        {reason ? `Reason: ${reason}` : 'Ops did not give a reason.'}
      </p>
      <div className="login__form">{children}</div>
    </section>
  );
}
