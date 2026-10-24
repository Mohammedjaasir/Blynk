import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { expiryApi, type ExpirySummary } from '../api/expiry';
import { chipLines, severityClass } from '../lib/expiry';
import '../pages/expiry.css';

/**
 * The "expiring soon" chips on the Dashboard (wave 2, 2026-10-25): expired, this week, this month.
 * Shows nothing while loading, when nothing is expiring, and before migration 059 (the API answers 503).
 */
export function ExpiryChips() {
  const [summary, setSummary] = useState<ExpirySummary | null>(null);
  useEffect(() => {
    let live = true;
    expiryApi
      .summary()
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, []);
  const lines = chipLines(summary);
  if (lines.length === 0) return null;
  return (
    <section className="expiry-chips" aria-label="Expiring soon">
      {lines.map((l) => (
        <Link key={l.bucket} to="/expiry" className={severityClass(l.severity)}>
          {l.text}
        </Link>
      ))}
    </section>
  );
}
