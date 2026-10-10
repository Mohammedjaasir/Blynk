import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { referralPoints, type ReferralMode, type ReferralSetting } from '../api/referralPoints';
import { errorMessage } from '../lib/apiErrors';
import {
  FRIEND_UNUSED_TO_CREDIT_HINT,
  MAX_REFERRAL_LKR,
  REFERRAL_MODE_LABEL,
  REFERRAL_RULES,
  changedFields,
  numberText,
  readReferralForm,
  referralSummary,
} from '../lib/referralPoints';
import { Field, Spinner, useToast } from './ui';

const MODES: ReferralMode[] = ['LKR_OFF', 'FREE_DELIVERY'];

/**
 * Settings -> Refer a friend (owner, 2026-10-10): the switch, the reward
 * (LKR off for each side, or free delivery), the monthly cap per inviter and
 * whether an unused friend reward becomes a credit (owner, 2026-10-10).
 * Operations has the same controls under More. PATCH sends only what changed.
 */
export function ReferralSettingsCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<ReferralSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<ReferralMode>('LKR_OFF');
  const [friend, setFriend] = useState('200');
  const [inviter, setInviter] = useState('200');
  const [cap, setCap] = useState('10');
  const [friendUnusedToCredit, setFriendUnusedToCredit] = useState(true);
  const [fieldError, setFieldError] = useState<{ field: 'friend' | 'inviter' | 'cap'; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    let cancelled = false;
    referralPoints
      .getReferralSetting()
      .then((s) => !cancelled && show(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load refer a friend.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setSaveError(null);
    const read = readReferralForm({ enabled, mode, friend, inviter, cap, friendUnusedToCredit });
    if ('error' in read) {
      setFieldError({ field: read.field, message: read.error });
      return;
    }
    setFieldError(null);
    // Free delivery keeps the saved LKR amounts for a later switch back.
    const next =
      read.value.mode === 'FREE_DELIVERY'
        ? { ...read.value, friend_amount_lkr: current.friend_amount_lkr, inviter_amount_lkr: current.inviter_amount_lkr }
        : read.value;
    const body = changedFields(current, { ...next, updated_at: current.updated_at });
    if (Object.keys(body).length === 0) {
      toast.success('Nothing changed.');
      return;
    }
    setSaving(true);
    try {
      show(await referralPoints.setReferralSetting(body));
      toast.success('Refer a friend saved.');
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save refer a friend.'));
    } finally {
      setSaving(false);
    }
  }

  const preview = readReferralForm({ enabled, mode, friend, inviter, cap, friendUnusedToCredit });
  const errorFor = (field: 'friend' | 'inviter' | 'cap') => (fieldError?.field === field ? fieldError.message : undefined);

  return (
    <section className="panel" aria-label="Refer a friend">
      <h2 className="panel__title">Refer a friend</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading refer a friend" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              Refer a friend
              <em>Customers share their code; a new account that uses it gets a reward, and so does the customer who invited them.</em>
            </span>
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label">Reward</legend>
            {MODES.map((m) => (
              <label key={m} className="toggle">
                <input type="radio" name="admin-referral-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                <span>{REFERRAL_MODE_LABEL[m]}</span>
              </label>
            ))}
          </fieldset>
          {mode === 'LKR_OFF' ? (
            <>
              <Field
                label="Friend's reward (LKR off their first order)"
                hint={`Off the items, not the delivery fee. 0 to ${MAX_REFERRAL_LKR.toLocaleString('en-LK')}.`}
                error={errorFor('friend')}
              >
                <input className="input" inputMode="decimal" value={friend} onChange={(e) => setFriend(e.target.value)} />
              </Field>
              <Field label="Inviter's reward (LKR off their next order)" error={errorFor('inviter')}>
                <input className="input" inputMode="decimal" value={inviter} onChange={(e) => setInviter(e.target.value)} />
              </Field>
            </>
          ) : null}
          <Field
            label="Monthly cap per inviter"
            hint="The most inviter rewards one customer can earn in a month (1 to 1,000)."
            error={errorFor('cap')}
          >
            <input className="input" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          <label className="toggle">
            <input
              type="checkbox"
              checked={friendUnusedToCredit}
              onChange={(e) => setFriendUnusedToCredit(e.target.checked)}
            />
            <span>
              Unused friend reward becomes a credit
              <em>{FRIEND_UNUSED_TO_CREDIT_HINT}</em>
            </span>
          </label>
          {'value' in preview ? (
            <p className="form__note" data-testid="referral-summary">
              {referralSummary(preview.value)}
            </p>
          ) : null}
          <ul className="form__note" aria-label="How refer a friend works">
            {REFERRAL_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className="form__note">
            <Link className="link" to="/referrals">
              See every referral
            </Link>
          </p>
          {current.updated_at ? <p className="form__note">Changed {new Date(current.updated_at).toLocaleString()}.</p> : null}
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
