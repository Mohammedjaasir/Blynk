import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { stockState, unitsLabel } from '../lib/stock';
import type { StockRow } from '../api/types';
import { errorMessage, isForbidden } from '../lib/errors';

// ----------------------------------------------------------------- status

/** Stock state as word + count; the colour only reinforces the word. */
export function StockStatus({
  row,
}: {
  row: Pick<StockRow, 'tracking_mode' | 'quantity_available' | 'quantity_on_hand' | 'low_stock_threshold'>;
}) {
  const state = stockState(row);
  return (
    <span className={`stock stock--${state.kind.toLowerCase()}`}>
      <span className="stock__word">{state.label}</span>
      {state.units !== null ? <span className="stock__units">{unitsLabel(state.units)}</span> : null}
    </span>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

/** A dot and a word. Used for customer state, supplier and item status. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`status status--${tone}`}>
      <span className="status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- loading / empty / error

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner__ring" aria-hidden="true" />
    </span>
  );
}

/** Placeholder rows shaped like the table they stand in for. */
export function SkeletonRows({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <tbody aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeleton-row">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <span className="skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {message ? <p className="empty__message">{message}</p> : null}
      {action}
    </div>
  );
}

/**
 * The one way a screen reports a failed load: 403 reads as "no access",
 * everything else as the API's message with a retry.
 */
export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isForbidden(error)) {
    return (
      <div className="notice notice--bad" role="alert">
        <strong>No access.</strong> Your account is not allowed to see this. Ask a Blynk admin if you need it.
      </div>
    );
  }
  return (
    <div className="notice notice--bad" role="alert">
      <span>{errorMessage(error, 'This could not be loaded.')}</span>
      {onRetry ? (
        <button type="button" className="button button--ghost button--sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- dialog

/**
 * Modal with a focus trap: Tab cycles inside, Escape closes, and focus goes
 * back to whatever opened it.
 */
export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]'
        ) ?? []
      );
    (panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal" role="presentation">
      <div
        ref={panelRef}
        className={`modal__panel${wide ? ' modal__panel--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Dialog title={title} onClose={onCancel}>
      <div className="modal__body">{children}</div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="modal__actions">
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button" onClick={onConfirm} disabled={busy} data-autofocus>
          {busy ? <Spinner label="Working" /> : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------------- forms

/**
 * Label + control + hint/error. The control's accessible name is the label
 * alone; the hint or error is attached with aria-describedby, and an error
 * also sets aria-invalid.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactElement;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const control = cloneElement(children, {
    id,
    'aria-describedby': note ? noteId : undefined,
    'aria-invalid': error ? true : undefined,
  });
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {control}
      {error ? (
        <span id={noteId} className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={noteId} className="field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  noun,
  plural = `${noun}s`,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  noun: string;
  plural?: string;
  onPage(page: number): void;
}) {
  return (
    <nav className="pager" aria-label="Pages">
      <span className="pager__count">
        {total} {total === 1 ? noun : plural} · page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <button
        type="button"
        className="button button--ghost button--sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

// ----------------------------------------------------------------- toast

type ToastKind = 'success' | 'error';
interface ToastApi {
  success(message: string): void;
  error(message: string): void;
}
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; kind: ToastKind; message: string }>>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { id, kind, message }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 5000);
  }, []);
  const api = useRef<ToastApi>({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
  });
  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
