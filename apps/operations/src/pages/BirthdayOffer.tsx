import { useEffect, useId, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { BirthdayCustomer, BirthdayOfferSetting } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import {
  MAX_BIRTHDAY_SMS,
  birthdayWhen,
  fillPercent,
  formatDayMonth,
  formatDayMonthYear,
  parseBirthdayPercent,
  percentText,
} from '../lib/birthday';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { partsText, smsParts } from '../lib/sms';
import { readablePhone } from './RiderRequests';

/**
 * More -> Birthday offer (owner, 2026-10-09). The store switch for "X% off
 * ONE order in the customer's birthday week" (birthday +-3 days, Colombo
 * time) and the birthday SMS sent on the day, plus who has a birthday this
 * week. Admin has the same controls under Settings; the backend applies the
 * gift at checkout (never with a coupon - the larger discount wins).
 */
export function BirthdayOffer() {
  return (
    <div className="page">
      <PageHeader title="Birthday offer" description="A gift for each customer's birthday week, and a birthday SMS." />
      <BirthdayOfferCard />
      <BirthdaysThisWeek />
    </div>
  );
}

function BirthdayOfferCard() {
  const smsId = useId();
  const countId = useId();
  const [current, setCurrent] = useState<BirthdayOfferSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [percent, setPercent] = useState('10');
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [smsText, setSmsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: BirthdayOfferSetting) {
    setCurrent(s);
    setEnabled(s.enabled);
    setPercent(percentText(s.percent));
    setSmsEnabled(s.sms_enabled);
    setSmsText(s.sms_text);
  }

  useEffect(() => {
    settings.birthdayOffer
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const parsed = parseBirthdayPercent(percent);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const text = smsText.trim();
    if (!text) {
      setError('Write the birthday SMS.');
      return;
    }
    if (text.length > MAX_BIRTHDAY_SMS) {
      setError(`The SMS can be at most ${MAX_BIRTHDAY_SMS} characters.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      show(await settings.birthdayOffer.update({ enabled, percent: parsed.value, sms_enabled: smsEnabled, sms_text: text }));
      setNotice('Birthday offer saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // While typing, the preview fills {percent} locally; once saved (nothing
  // changed since), it is the server's own preview and part count.
  const parsedPercent = parseBirthdayPercent(percent);
  const shownPercent = 'value' in parsedPercent ? percentText(parsedPercent.value) : current ? percentText(current.percent) : '';
  const unchanged =
    !!current && smsText.trim() === current.sms_text.trim() && 'value' in parsedPercent && parsedPercent.value === current.percent;
  const preview = unchanged && current ? current.sms_preview : fillPercent(smsText, shownPercent);
  const parts = unchanged && current ? current.sms_parts : preview ? smsParts(preview) : 0;

  return (
    <section className="card" aria-labelledby="birthday-offer-title">
      <h2 className="section-label" id="birthday-offer-title">
        Birthday offer
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading birthday offer" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <strong>Birthday offer</strong>
              <em>
                % off one order in the customer's birthday week ({current.window_days} days either side). Not with a coupon - the
                bigger discount wins.
              </em>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Birthday discount (%)</span>
            <input
              className="input"
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-invalid={error && 'error' in parsedPercent ? true : undefined}
            />
            <span className="field__hint">Off the items, not the delivery fee. Up to 50%.</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} />
            <span>
              <strong>Birthday SMS</strong>
              <em>Sent on the birthday from 8 AM, once a year, only while the offer is on and the customer gets offers by SMS.</em>
            </span>
          </label>
          <div className="field sms-text">
            <label className="field__label" htmlFor={smsId}>
              Birthday SMS text
            </label>
            <textarea
              id={smsId}
              className="input"
              rows={3}
              maxLength={MAX_BIRTHDAY_SMS}
              value={smsText}
              aria-describedby={countId}
              disabled={!smsEnabled}
              onChange={(e) => setSmsText(e.target.value)}
            />
            <span id={countId} className="field__hint" data-testid="birthday-sms-count">
              {smsText.length}/{MAX_BIRTHDAY_SMS} characters{preview ? ` · ${partsText(parts)}` : ''} · {'{percent}'} becomes the %
            </span>
          </div>
          {preview ? (
            <div className="sms-preview" aria-label="Birthday SMS preview">
              {preview}
            </div>
          ) : null}
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}

/** Customers in (or about to be in) their birthday week - so the shop can
 * add a small extra to the bag (owner, 2026-10-09). */
function BirthdaysThisWeek() {
  const [rows, setRows] = useState<BirthdayCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settings
      .birthdays(7)
      .then((d) => setRows(d.customers))
      .catch((err) => setError(catalogErrorMessage(err)));
  }, []);

  return (
    <section className="card" aria-labelledby="birthdays-title">
      <h2 className="section-label" id="birthdays-title">
        Birthdays this week
      </h2>
      {error ? (
        <p className="field__error">{error}</p>
      ) : !rows ? (
        <Spinner label="Loading birthdays" />
      ) : rows.length === 0 ? (
        <EmptyState title="No birthdays this week" message="Customers who save their date of birth in the app show up here." />
      ) : (
        <ul className="cat-list" aria-label="Birthdays this week">
          {rows.map((c) => (
            <li key={c.id} className="cat-row cat-row--flat birthday-row">
              <div className="cat-row__main">
                <p className="cat-row__title">
                  {c.full_name ?? 'Customer'}
                  {c.offer_used ? <span className="pay-tag pay-tag--company birthday-row__used">Gift used</span> : null}
                </p>
                <p className="cat-row__meta">
                  <span className={c.days_until === 0 ? 'birthday-when birthday-when--today' : 'birthday-when'}>
                    {birthdayWhen(c.days_until)}
                  </span>
                  {' · '}
                  {formatDayMonth(c.birthday)} · turning {c.turning}
                </p>
                <p className="cat-row__meta">
                  <span className="mono">{readablePhone(c.phone)}</span>
                  {' · born '}
                  {formatDayMonthYear(c.date_of_birth)}
                </p>
                {c.favourite_categories.length > 0 ? (
                  <ul className="birthday-chips" aria-label="Favourite categories">
                    {c.favourite_categories.map((cat) => (
                      <li key={cat.id} className="birthday-chip">
                        {cat.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {c.favourites_note ? <p className="cat-row__meta birthday-row__note">“{c.favourites_note}”</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
