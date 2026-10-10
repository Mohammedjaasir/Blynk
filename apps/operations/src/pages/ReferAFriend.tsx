import { useEffect, useState, type FormEvent } from 'react';
import { referralPoints, type Referral, type ReferralMode, type ReferralPage, type ReferralSetting, type ReferralStatus } from '../api/referralPoints';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner, Status, type Tone } from '../components/ui';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { shortNumber } from '../lib/orders';
import {
  FRIEND_UNUSED_TO_CREDIT_HINT,
  MAX_REFERRAL_LKR,
  REFERRAL_MODE_LABEL,
  REFERRAL_RULES,
  REFERRAL_STATUSES,
  REFERRAL_STATUS_HINT,
  REFERRAL_STATUS_LABEL,
  changedFields,
  numberText,
  readReferralForm,
  referralSummary,
  rewardText,
} from '../lib/referralPoints';
import { readablePhone } from './RiderRequests';

/**
 * More -> Refer a friend (owner, 2026-10-10). The store switch and rewards
 * for "invite a friend, you both get something", and every referral with
 * where it stands. Admin has the same controls under Settings; the backend
 * applies the rewards at checkout and when the friend's order is delivered.
 */
export function ReferAFriend() {
  return (
    <div className="page">
      <PageHeader title="Refer a friend" description="Rewards for customers who invite a friend, and every referral so far." />
      <ReferralSettingsCard />
      <ReferralsList />
    </div>
  );
}

const MODES: ReferralMode[] = ['LKR_OFF', 'FREE_DELIVERY'];

function ReferralSettingsCard() {
  const [current, setCurrent] = useState<ReferralSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<ReferralMode>('LKR_OFF');
  const [friend, setFriend] = useState('200');
  const [inviter, setInviter] = useState('200');
  const [cap, setCap] = useState('10');
  const [friendUnusedToCredit, setFriendUnusedToCredit] = useState(true);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: ReferralSetting) {
    setCurrent(s);
    setEnabled(s.enabled);
    setMode(s.mode);
    setFriend(numberText(s.friend_amount_lkr));
    setInviter(numberText(s.inviter_amount_lkr));
    setCap(String(s.monthly_cap));
    setFriendUnusedToCredit(s.friend_unused_to_credit);
  }

  useEffect(() => {
    referralPoints
      .getReferralSetting()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setNotice(null);
    const read = readReferralForm({ enabled, mode, friend, inviter, cap, friendUnusedToCredit });
    if ('error' in read) {
      setError({ message: read.error, field: read.field });
      return;
    }
    // Free delivery keeps the saved LKR amounts for a later switch back.
    const next =
      read.value.mode === 'FREE_DELIVERY'
        ? { ...read.value, friend_amount_lkr: current.friend_amount_lkr, inviter_amount_lkr: current.inviter_amount_lkr }
        : read.value;
    const body = changedFields(
      {
        enabled: current.enabled,
        mode: current.mode,
        friend_amount_lkr: current.friend_amount_lkr,
        inviter_amount_lkr: current.inviter_amount_lkr,
        monthly_cap: current.monthly_cap,
        friend_unused_to_credit: current.friend_unused_to_credit,
      },
      next
    );
    setError(null);
    if (Object.keys(body).length === 0) {
      setNotice('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      show(await referralPoints.setReferralSetting(body));
      setNotice('Refer a friend saved.');
    } catch (err) {
      setError({ message: catalogErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const preview = readReferralForm({ enabled, mode, friend, inviter, cap, friendUnusedToCredit });

  return (
    <section className="card" aria-labelledby="referral-settings-title">
      <h2 className="section-label" id="referral-settings-title">
        Refer a friend
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading refer a friend" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <strong>Refer a friend</strong>
              <em>Customers share their code; a new account that uses it gets a reward, and so does the customer who invited them.</em>
            </span>
          </label>
          <fieldset className="choice">
            <legend className="field__label">Reward</legend>
            {MODES.map((m) => (
              <label key={m} className={`choice__option${mode === m ? ' is-selected' : ''}`}>
                <input type="radio" name="referral-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                <span>
                  <strong>{REFERRAL_MODE_LABEL[m]}</strong>
                </span>
              </label>
            ))}
          </fieldset>
          {mode === 'LKR_OFF' ? (
            <>
              <label className="field">
                <span className="field__label">Friend's reward (LKR off their first order)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={friend}
                  onChange={(e) => setFriend(e.target.value)}
                  aria-invalid={error?.field === 'friend' ? true : undefined}
                />
                <span className="field__hint">Off the items, not the delivery fee. 0 to {MAX_REFERRAL_LKR.toLocaleString('en-LK')}.</span>
              </label>
              <label className="field">
                <span className="field__label">Inviter's reward (LKR off their next order)</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={inviter}
                  onChange={(e) => setInviter(e.target.value)}
                  aria-invalid={error?.field === 'inviter' ? true : undefined}
                />
              </label>
            </>
          ) : null}
          <label className="field">
            <span className="field__label">Monthly cap per inviter</span>
            <input
              className="input"
              inputMode="numeric"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              aria-invalid={error?.field === 'cap' ? true : undefined}
            />
            <span className="field__hint">The most inviter rewards one customer can earn in a month (1 to 1,000).</span>
          </label>
          {/* (owner, 2026-10-10) "give all the options to control to ops and admin". */}
          <label className="toggle">
            <input
              type="checkbox"
              checked={friendUnusedToCredit}
              onChange={(e) => setFriendUnusedToCredit(e.target.checked)}
            />
            <span>
              <strong>Unused friend reward becomes a credit</strong>
              <em>{FRIEND_UNUSED_TO_CREDIT_HINT}</em>
            </span>
          </label>
          {'value' in preview ? (
            <p className="quiet" data-testid="referral-summary">
              {referralSummary(preview.value)}
            </p>
          ) : null}
          <ul className="quiet referral-rules" aria-label="How refer a friend works">
            {REFERRAL_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error.message}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}

const STATUS_TONE: Record<ReferralStatus, Tone> = { PENDING: 'info', REWARDED: 'ok', CAPPED: 'warn', NO_REWARD: 'muted' };
const PAGE_SIZE = 50;

function ReferralsList() {
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
      .catch((err) => !cancelled && setError(catalogErrorMessage(err)));
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
    <section className="card" aria-labelledby="referrals-title">
      <h2 className="section-label" id="referrals-title">
        Referrals
      </h2>
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
      {status ? <p className="quiet">{REFERRAL_STATUS_HINT[status]}</p> : null}
      {error ? (
        <p className="field__error">{error}</p>
      ) : !data ? (
        <Spinner label="Loading referrals" />
      ) : data.referrals.length === 0 ? (
        <EmptyState title="No referrals yet" message={status ? `Nothing is ${REFERRAL_STATUS_LABEL[status].toLowerCase()}.` : 'Referrals show up here once a new customer signs up with a code.'} />
      ) : (
        <>
          <ul className="cat-list" aria-label="Referrals">
            {data.referrals.map((r) => (
              <ReferralRow key={r.id} referral={r} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav className="filters" aria-label="Pages">
              <span className="page__note">
                {data.pagination.total} referrals · page {page} of {pages}
              </span>
              <div className="actions-row">
                <button type="button" className="button button--ghost button--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button type="button" className="button button--ghost button--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next
                </button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}

function ReferralRow({ referral: r }: { referral: Referral }) {
  const inviterReward = r.inviter_reward;
  return (
    <li className="cat-row cat-row--flat referral-row">
      <div className="cat-row__main">
        <p className="cat-row__title">
          {r.friend.name ?? 'New customer'} <span className="quiet">invited by</span> {r.inviter.name ?? 'Customer'}{' '}
          <Status tone={STATUS_TONE[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Status>
        </p>
        <p className="cat-row__meta">
          <span className="mono">{readablePhone(r.friend.phone)}</span>
          {' ← '}
          <span className="mono">{readablePhone(r.inviter.phone)}</span>
          {' · code '}
          <span className="mono">{r.code}</span>
          {' · '}
          {formatDateTime(r.created_at)}
        </p>
        <p className="cat-row__meta">
          Friend:{' '}
          {r.friend_reward
            ? `${rewardText(r.friend_reward.mode, r.friend_reward.amount_lkr)}${r.friend_reward.used && r.friend_reward.order_number ? ` on #${shortNumber(r.friend_reward.order_number)}` : ' (not used yet)'}`
            : '—'}
          {' · Inviter: '}
          {inviterReward
            ? `${rewardText(inviterReward.mode, inviterReward.amount_lkr)}${inviterReward.used ? (inviterReward.order_number ? ` used on #${shortNumber(inviterReward.order_number)}` : ' used') : ' - waiting for their next order'}`
            : '—'}
          {r.qualifying_order_number ? ` · first order #${shortNumber(r.qualifying_order_number)}` : ''}
        </p>
      </div>
    </li>
  );
}
