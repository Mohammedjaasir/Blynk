import { useCallback, useEffect, useState } from 'react';
import { sellerApi } from '../api/resources';
import type { Statement as StatementData } from '../api/types';
import { IconBox, IconCalendar, IconWallet } from '../components/icons';
import { Illustration } from '../components/Illustration';
import { EmptyState, ErrorState, Eyebrow, PageLoading } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatDate, formatNumber, lkr, todayColombo } from '../lib/format';

interface Range {
  from: string;
  to: string;
}

function monthStart(today: string): string {
  return `${today.slice(0, 8)}01`;
}

function daysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Share of the whole, 0-100, for the bars. */
function share(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

function paidShare(data: StatementData): number {
  return share(data.paid, data.earned);
}

/** What the seller earned from delivered orders, what was paid, and what is still due. */
export function Statement() {
  const [range, setRange] = useState<Range>({ from: '', to: '' });
  const [applied, setApplied] = useState<Range>({ from: '', to: '' });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: Range) => {
    setError(null);
    setData(null);
    try {
      setData(await sellerApi.statement({ from: r.from || undefined, to: r.to || undefined }));
    } catch (err) {
      setError(errorMessage(err, 'Could not load your statement. Please try again.'));
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  function apply(next: Range) {
    if (next.from && next.to && next.from > next.to) {
      setRangeError('The "From" date must not be after the "To" date.');
      return;
    }
    setRangeError(null);
    setRange(next);
    setApplied(next);
  }

  function preset(kind: 'month' | '30' | 'all') {
    const today = todayColombo();
    if (kind === 'month') apply({ from: monthStart(today), to: today });
    else if (kind === '30') apply({ from: daysAgo(today, 29), to: today });
    else apply({ from: '', to: '' });
  }

  const filtered = Boolean(applied.from || applied.to);

  return (
    <section aria-labelledby="statement-title">
      <div className="page__head">
        <div className="page__titles">
          <Eyebrow>Your money</Eyebrow>
          <h1 id="statement-title">Statement</h1>
          <p className="muted page__sub">
            Counts delivered orders only. Blynk collects the cash from customers and pays you by hand; each payment is
            listed below.
          </p>
        </div>
      </div>

      <form
        className="range"
        onSubmit={(e) => {
          e.preventDefault();
          apply(range);
        }}
      >
        <div className="range__fields">
          <div className="field">
            <label htmlFor="st-from">From</label>
            <input id="st-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-to">To</label>
            <input id="st-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
        </div>
        {rangeError ? (
          <p className="field__error" role="alert">
            {rangeError}
          </p>
        ) : null}
        <div className="range__actions">
          <button type="submit" className="button button--primary button--small">
            <IconCalendar size={17} /> Show these dates
          </button>
          <span className="range__presets">
            <button type="button" className="pill" onClick={() => preset('month')}>
              This month
            </button>
            <button type="button" className="pill" onClick={() => preset('30')}>
              Last 30 days
            </button>
            <button type="button" className="pill" onClick={() => preset('all')}>
              All time
            </button>
          </span>
        </div>
      </form>

      {error ? (
        <ErrorState message={error} onRetry={() => void load(applied)} />
      ) : data === null ? (
        <PageLoading label="Loading your statement" />
      ) : (
        <>
          <p className="muted" data-testid="range-label">
            {filtered
              ? `Showing ${applied.from ? formatDate(applied.from) : 'the start'} to ${applied.to ? formatDate(applied.to) : 'today'}`
              : 'Showing all time'}
          </p>
          <dl className="totals">
            <div className="total total--due">
              <dt>Blynk still owes you</dt>
              <dd>{lkr(data.due)}</dd>
              <dd className="due__bar" aria-hidden="true">
                <span style={{ ['--paid' as string]: `${paidShare(data)}%` }} />
              </dd>
              <dd className="due__caption">
                {data.earned > 0 ? `Blynk has paid ${paidShare(data)}% of what you earned` : 'Your earnings show here once orders are delivered'}
              </dd>
            </div>
            <div className="total">
              <dt>Sold</dt>
              <dd>{lkr(data.gross)}</dd>
            </div>
            <div className="total">
              <dt>Blynk commission ({formatNumber(data.commission_percent)}%)</dt>
              <dd>{lkr(data.commission)}</dd>
            </div>
            <div className="total">
              <dt>You earned</dt>
              <dd>{lkr(data.earned)}</dd>
            </div>
            <div className="total">
              <dt>Paid to you</dt>
              <dd>{lkr(data.paid)}</dd>
            </div>
          </dl>

          <div className="ledger-grid">
            <div className="ledger">
              <h2 className="ledger__title">
                <IconBox size={20} /> What sold
              </h2>
              {data.lines.length === 0 ? (
                <EmptyState
                  art={<Illustration name="receipt" />}
                  title="Nothing sold in these dates"
                  message="Delivered orders with your products will show up here."
                />
              ) : (
                <ul className="lines lines--sold">
                  {data.lines.map((line, index) => (
                    <li
                      key={line.product_id}
                      className="line line--sold"
                      style={{ ['--share' as string]: `${share(line.gross, data.gross)}%` }}
                    >
                      <span className="line__rank" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="line__name">{line.name}</span>
                      <span className="line__units">{formatNumber(line.units)} sold</span>
                      <span className="line__amount">{lkr(line.gross)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ledger">
              <h2 className="ledger__title">
                <IconWallet size={20} /> Payments from Blynk
              </h2>
              {data.payouts.length === 0 ? (
                <EmptyState
                  title="No payments yet"
                  message="When Blynk pays you, it will be listed here."
                  art={<Illustration name="wallet" />}
                />
              ) : (
                <ul className="lines lines--paid">
                  {data.payouts.map((payout) => (
                    <li key={payout.id} className="line line--paid">
                      <span className="line__name">
                        {formatDate(payout.paid_on)}
                        {payout.note ? <span className="muted"> - {payout.note}</span> : null}
                      </span>
                      <span className="line__amount">{lkr(payout.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
