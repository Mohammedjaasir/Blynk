import { useEffect, useState } from 'react';
import { pushManager } from '../lib/push';
import type { ForegroundMessage, PushManager } from '../lib/push/manager';
import { IconBell, IconClose } from './icons';

/** How long a toast stays when the seller does nothing. */
export const TOAST_MS = 8000;

interface Toast extends ForegroundMessage {
  id: number;
}

/**
 * A push that arrives while the app is open (Firebase onMessage) is shown here, in the app:
 * the browser does not draw its own notification for a visible page.
 */
export function Toaster({ ms = TOAST_MS, manager = pushManager }: { ms?: number; manager?: PushManager }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 1;
    return manager.onForeground((message) => {
      const id = next++;
      setToasts((current) => [...current.slice(-2), { ...message, id }]);
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), ms);
    });
  }, [ms, manager]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" role="status">
          <span className="toast__icon" aria-hidden="true">
            <IconBell size={18} />
          </span>
          <p className="toast__text">
            <strong>{toast.title}</strong>
            {toast.body ? <span>{toast.body}</span> : null}
          </p>
          <button
            type="button"
            className="toast__close"
            aria-label="Close notification"
            onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
          >
            <IconClose size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
