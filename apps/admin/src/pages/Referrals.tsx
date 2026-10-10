import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { referralPoints, type Referral, type ReferralPage, type ReferralReward, type ReferralStatus } from '../api/referralPoints';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatDay } from '../lib/coupons';
import { shortNumber } from '../lib/orders';
import { REFERRAL_STATUSES, REFERRAL_STATUS_HINT, REFERRAL_STATUS_LABEL, rewardText } from '../lib/referralPoints';

/**
 * /referrals (owner, 2026-10-10): every "refer a friend" - who invited whom,
 * where it stands and what each side got. The program's switch and rewards
 * live under Settings.
 */

const PAGE_SIZE = 50;
const STATUS_TONE: Record<ReferralStatus, 'active' | 'inactive' | 'muted' | 'offer'> = {
  PENDING: 'offer',
  REWARDED: 'active',
  CAPPED: 'inactive',
  NO_REWARD: 'muted',
};

export function Referrals() {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReferralPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    referralPoints
      .listReferrals({ status, page, limit: PAGE_SIZE })
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load referrals.')));
    return () => {
      cancelled = true;
    };
  }, [status, page]);

  function pick(next: ReferralStatus | null) {
    setPage(1);
    setStatus(next);
  }

  const pages = data?.pagination.total_pages ?? 1;
  return (
    <>
      <PageHeader
        title="Referrals"
        description="Customers who invited a friend, and the rewards each side got."
        actions={
          <Link className="button button--ghost" to="/settings">
            Refer a friend settings
          </Link>
        }
      />
      <div className="segmented" role="group" aria-label="Referral status">
        <button type="button" className={status === null ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={status === null} onClick={() => pick(null)}>
          All
        </button>
        {REFERRAL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={status === s ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={status === s}
            onClick={() => pick(s)}
          >
            {REFERRAL_STATUS_LABEL[s]}
            {data ? ` (${data.summary[s] ?? 0})` : ''}
          </button>
        ))}
      </div>
      {status ? <p className="cell__secondary">{REFERRAL_STATUS_HINT[status]}</p> : null}

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading referrals" /> : null}
      {data && data.referrals.length === 0 ? (
        <EmptyState
          title="No referrals yet"
          message={status ? `Nothing is ${REFERRAL_STATUS_LABEL[status].toLowerCase()}.` : 'Referrals show up here once a new customer signs up with a code.'}
        />
      ) : null}
      {data && data.referrals.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table" aria-label="Referrals">
              <thead>
                <tr>
                  <th scope="col">Friend</th>
                  <th scope="col">Invited by</th>
                  <th scope="col">Code</th>
                  <th scope="col">Status</th>
                  <th scope="col">Friend's reward</th>
                  <th scope="col">Inviter's reward</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.referrals.map((r) => (
                  <ReferralRow key={r.id} referral={r} />
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="Pages">
            <button type="button" className="button button--ghost button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="cell__secondary">
              Page {page} of {pages} · {data.pagination.total} {data.pagination.total === 1 ? 'referral' : 'referrals'}
            </span>
            <button type="button" className="button button--ghost button--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </nav>
        </>
      ) : null}
    </>
  );
}

function Person({ person, fallback }: { person: Referral['friend']; fallback: string }) {
  return (
    <>
      <Link className="link cell__primary" to={`/customers/${person.id}`}>
        {person.name || fallback}
      </Link>
      <span className="cell__secondary mono"> {person.phone}</span>
    </>
  );
}

function RewardCell({ reward, waiting }: { reward: ReferralReward | null; waiting: string }) {
  if (!reward) return <span className="cell__secondary">—</span>;
  return (
    <>
      {rewardText(reward.mode, reward.amount_lkr)}
      <span className="cell__secondary">
        {reward.used ? (reward.order_number ? ` · used on #${shortNumber(reward.order_number)}` : ' · used') : ` · ${waiting}`}
      </span>
    </>
  );
}

function ReferralRow({ referral: r }: { referral: Referral }) {
  return (
    <tr>
      <td>
        <Person person={r.friend} fallback="New customer" />
      </td>
      <td>
        <Person person={r.inviter} fallback="Customer" />
      </td>
      <td className="mono">{r.code}</td>
      <td>
        <Badge tone={STATUS_TONE[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Badge>
        {r.qualifying_order_number ? (
          <span className="cell__secondary"> · first order #{shortNumber(r.qualifying_order_number)}</span>
        ) : null}
      </td>
      <td>
        <RewardCell reward={r.friend_reward} waiting="not used yet" />
      </td>
      <td>
        <RewardCell reward={r.inviter_reward} waiting="waiting for their next order" />
      </td>
      <td className="cell__secondary">{formatDay(r.created_at)}</td>
    </tr>
  );
}
