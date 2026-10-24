import type { ReactNode } from 'react';
import { IconAlert, IconArrowRight, IconBox, IconRefresh } from './icons';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner__dot" />
    </span>
  );
}

export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="center-block">
      <Spinner label={label} />
      <p className="muted">{label}...</p>
    </div>
  );
}

/** The round arrow that sits inside a main button ("button in a button"). */
export function ButtonArrow() {
  return (
    <span className="button__badge" aria-hidden="true">
      <IconArrowRight size={18} />
    </span>
  );
}

/** The small pill above a page title. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function EmptyState({
  title,
  message,
  action,
  icon,
  art,
  className,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
  /** A drawn illustration in place of the small icon tile. */
  art?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`empty${art ? ' empty--art' : ''}${className ? ` ${className}` : ''}`}>
      {art ? (
        <div className="empty__art">{art}</div>
      ) : (
        <span className="empty__icon" aria-hidden="true">
          {icon ?? <IconBox size={26} />}
        </span>
      )}
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
      {action}
    </div>
  );
}

/** A large number tile (the home screen's shop numbers). */
export function Kpi({
  label,
  value,
  hint,
  icon,
  tone = 'plain',
  index = 0,
  meter,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: 'plain' | 'ink';
  index?: number;
  /** 0-100: a thin bar under the value (how much of the earnings Blynk has paid). */
  meter?: number;
}) {
  return (
    <div className={`kpi kpi--${tone} rise`} style={{ ['--i' as string]: index }}>
      <dt className="kpi__label">
        {icon ? (
          <span className="kpi__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="kpi__value">{value}</dd>
      {meter !== undefined ? (
        <dd className="kpi__meter" aria-hidden="true">
          <span style={{ ['--meter' as string]: `${Math.max(0, Math.min(100, meter))}%` }} />
        </dd>
      ) : null}
      {hint ? <dd className="kpi__hint">{hint}</dd> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice--bad notice--row" role="alert">
      <span className="notice__icon" aria-hidden="true">
        <IconAlert size={20} />
      </span>
      <div className="notice__body">
        <p>{message}</p>
        {onRetry ? (
          <button type="button" className="button button--ghost button--small" onClick={onRetry}>
            <IconRefresh size={16} /> Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled form control with an optional hint and an inline error. */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  hideOptional,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Leave out the "(optional)" note (for screens where every box is needed). */
  hideOptional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="field__req"> (required)</span>
        ) : hideOptional ? null : (
          <span className="field__opt"> (optional)</span>
        )}
      </label>
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** aria-describedby for a Field's control. */
export function describedBy(id: string, hasHint: boolean, error?: string | null): string | undefined {
  const ids = [hasHint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return ids || undefined;
}
