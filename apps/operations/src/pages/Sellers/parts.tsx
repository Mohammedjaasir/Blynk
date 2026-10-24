import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Status, type Tone } from '../../components/ui';
import { SELLER_STATUS_LABEL, type SellerStatus } from '../../lib/sellers';
import './sellers.css';

/** The "← More" link every seller screen starts with. */
export function BackToMore({ to = '/more', label = '← More' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className="link">
      {label}
    </Link>
  );
}

export const STATUS_TONE: Record<SellerStatus, Tone> = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'muted', SUSPENDED: 'bad' };

export function SellerStatusPill({ status }: { status: SellerStatus }) {
  return <Status tone={STATUS_TONE[status]}>{SELLER_STATUS_LABEL[status]}</Status>;
}

/**
 * A bottom sheet (a form in a dialog): same `.modal` backdrop as the other Ops dialogs, the panel
 * sits on the bottom edge so the thumb reaches it. Enter submits.
 */
export function Sheet({
  label,
  title,
  message,
  busy,
  submitLabel,
  submitTone = 'ink',
  submitDisabled,
  onClose,
  onSubmit,
  children,
}: {
  label: string;
  title: string;
  message?: string;
  busy: boolean;
  submitLabel: string;
  submitTone?: 'ink' | 'danger';
  submitDisabled?: boolean;
  onClose(): void;
  onSubmit(): void;
  children?: ReactNode;
}) {
  return (
    <div className="modal seller-sheet" role="dialog" aria-modal="true" aria-label={label}>
      <form
        className="modal__panel"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <h2 className="modal__title">{title}</h2>
        {message ? <p className="modal__message">{message}</p> : null}
        {children}
        <div className="seller-sheet__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={submitTone === 'danger' ? 'button button--danger' : 'button button--ink'} disabled={busy || submitDisabled}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A labelled field with an inline error (the Ops `Field` shows hint or error but not both styles we need here). */
export function TextField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? (
        <span className="field__error-text" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </label>
  );
}

/** A section's load state: rows, "after the database update" (503 *_NOT_READY), or an error. */
export type Loaded<T> = { rows: T[] } | { notReady: true } | { error: string } | null;
