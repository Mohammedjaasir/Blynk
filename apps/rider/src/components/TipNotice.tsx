import { useCallback, useEffect, useState } from 'react';
import { earningsApi } from '../api/resources';
import type { RiderEarnings } from '../api/types';
import { takeNewWalletTip, tipReceivedText } from '../lib/tips';
import { useLoad } from '../lib/useLoad';
import { useRevalidate } from '../lib/useRevalidate';

/**
 * "You received a LKR 80 tip" (owner, 2026-10-24): shown once when a wallet
 * tip has appeared in today's earnings since the rider last looked (the
 * last-seen total is kept in local storage). Small, dismissible, never in the
 * way - it renders nothing when there is no new tip or the API predates tips.
 */
export function TipNotice({ earnings }: { earnings: RiderEarnings | null | undefined }) {
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    const fresh = takeNewWalletTip(earnings);
    // A repeat run (revalidation, strict mode) finds nothing new: keep what is shown.
    if (fresh > 0) setAmount(fresh);
  }, [earnings]);

  if (amount <= 0) return null;
  return (
    <div className="tip-notice" role="status" data-testid="tip-notice">
      <span className="tip-notice__text">{tipReceivedText(amount)}</span>
      <button type="button" className="tip-notice__close" onClick={() => setAmount(0)} aria-label="Dismiss tip notice">
        ×
      </button>
    </div>
  );
}

/** The home screen's version: fetches the earnings itself, and a failed load only means no notice. */
export function HomeTipNotice() {
  const { data, reload } = useLoad(() => earningsApi.get(), []);
  // Slower than the delivery list: a tip is not urgent.
  const refresh = useCallback(() => void reload(), [reload]);
  useRevalidate(refresh, 120_000);
  return <TipNotice earnings={data} />;
}
