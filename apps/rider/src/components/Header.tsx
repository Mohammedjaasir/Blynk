import { useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import mark from '../assets/blynk-mark.png';
import { Sheet } from './Sheet';

/**
 * The only chrome in the app: who is signed in, a refresh, and sign out.
 * `leading` replaces the mark on inner screens (a back link).
 *
 * Owner, 2026-10-09: "My day" sat right beside "Sign out" and riders could
 * hit the wrong one. My day is now a card on the deliveries list (Queue),
 * and Sign out asks first.
 */
export function Header({
  onRefresh,
  refreshing,
  refreshLabel,
  leading,
}: {
  onRefresh(): void;
  refreshing: boolean;
  refreshLabel: string;
  leading?: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || 'Rider';
  return (
    <header className="bar">
      {leading ?? (
        <span className="bar__brand">
          <img src={mark} alt="" className="bar__mark" />
          <span className="bar__name">{firstName}</span>
        </span>
      )}
      <span className="bar__actions">
        <button
          type="button"
          className={`icon-button${refreshing ? ' icon-button--spinning' : ''}`}
          onClick={onRefresh}
          aria-label={refreshLabel}
          aria-busy={refreshing}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {/* Home only: signing out mid-delivery is never the next step. */}
        {leading ? null : (
          <button type="button" className="bar__signout" onClick={() => setConfirming(true)}>
            Sign out
          </button>
        )}
      </span>
      {confirming ? (
        <Sheet title="Sign out?" onClose={() => setConfirming(false)}>
          <p className="sheet__hint">You won't get new deliveries until you sign in again.</p>
          <div className="sheet__actions">
            <button type="button" className="danger" onClick={() => void signOut()}>
              Sign out
            </button>
            <button type="button" className="text-button" data-autofocus onClick={() => setConfirming(false)}>
              Stay signed in
            </button>
          </div>
        </Sheet>
      ) : null}
    </header>
  );
}
