import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { smsOffers as smsOffersApi } from '../api/resources';
import type { SmsLanguage, SmsOffer, SmsOfferAudience, SmsOfferEstimate } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { useSignedInUser } from '../auth/AuthContext';
import { formatDay } from '../lib/coupons';
import { formatClock } from '../lib/orders';
import {
  AUDIENCE_LABEL,
  LANGUAGE_LABEL,
  LAUNCH_LANGUAGES,
  MAX_OFFER_TEXT,
  SMS_LANGUAGES,
  languageList,
  offerInput,
  offerParts,
  partsLabel,
  smsOfferErrorMessage,
} from '../lib/smsOffers';

/**
 * Offer SMS to registered customers (backend migration 027). Each customer
 * gets the text in the language they picked in the app, or the fallback;
 * customers who turned "Offers by SMS" off get nothing. The API decides the
 * audience, appends the opt-out line and enforces the sending window (the opening hours set in Settings, owner 2026-10-10).
 *
 * Which languages offers are written in is a backend setting
 * (SMS_OFFER_LANGUAGES, English only at launch) that each estimate reports;
 * the page shows text boxes for those languages only.
 */

/** Wait this long after the last change before asking for a new estimate. */
export const ESTIMATE_DELAY_MS = 400;

const EMPTY_TEXTS: Record<SmsLanguage, string> = { si: '', ta: '', en: '' };

/** A Sri Lankan mobile, as the API's normaliser accepts it. */
const TEST_PHONE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;

type Estimate = { key: string; data: SmsOfferEstimate } | { key: string; error: string } | null;

export function SmsOffers() {
  const toast = useToast();
  const [audience, setAudience] = useState<SmsOfferAudience>('ALL');
  const [fallback, setFallback] = useState<SmsLanguage>('en');
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(EMPTY_TEXTS);
  const [estimate, setEstimate] = useState<Estimate>(null);
  const [languages, setLanguages] = useState<readonly SmsLanguage[]>(LAUNCH_LANGUAGES);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [history, setHistory] = useState<SmsOffer[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // "Send test to": admins have no phone (backend migration 028), so they
  // enter one; prefilled with the account's own phone when it has one.
  const ownPhone = useSignedInUser()?.phone ?? '';
  const [testPhone, setTestPhone] = useState(ownPhone);
  useEffect(() => {
    if (ownPhone) setTestPhone((current) => current || ownPhone);
  }, [ownPhone]);

  const enabled = useMemo(() => SMS_LANGUAGES.filter((l) => languages.includes(l)), [languages]);
  const multilingual = enabled.length > 1;
  const input = useMemo(() => offerInput(audience, fallback, texts, enabled), [audience, fallback, texts, enabled]);
  const key = JSON.stringify(input);

  // Debounced estimate; only the answer for the latest inputs is kept.
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    const timer = setTimeout(() => {
      smsOffersApi
        .estimate(JSON.parse(key))
        .then((data) => {
          if (latest.current !== key) return;
          setEstimate({ key, data });
          // Keep the same array when unchanged so the body (and key) stays put.
          if (data.languages?.length) setLanguages((now) => (now.join() === data.languages.join() ? now : data.languages));
        })
        .catch((err) => latest.current === key && setEstimate({ key, error: smsOfferErrorMessage(err, 'Could not count the customers.') }));
    }, ESTIMATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await smsOffersApi.list());
      setHistoryError(null);
    } catch (err) {
      setHistoryError(smsOfferErrorMessage(err, 'Could not load sent offers.'));
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const current = estimate && estimate.key === key && 'data' in estimate ? estimate.data : null;
  const hasText = Object.keys(input.messages).length > 0;
  const canSend = !!current && hasText && current.recipients > 0 && current.missing_languages.length === 0 && !sending;

  async function send() {
    if (!current) return;
    setConfirming(false);
    setSending(true);
    setSendError(null);
    try {
      const offer = await smsOffersApi.send(input);
      toast.success(`Offer sent to ${offer.recipients} ${offer.recipients === 1 ? 'customer' : 'customers'}.`);
      setTexts(EMPTY_TEXTS);
      void loadHistory();
    } catch (err) {
      setSendError(smsOfferErrorMessage(err, 'Could not send the offer.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="SMS offers"
        description={
          multilingual
            ? 'Each customer gets the offer in the language they picked in the app. Sent during opening hours only.'
            : `Sent in ${LANGUAGE_LABEL[enabled[0] ?? 'en']} to every customer who gets offers. Sent during opening hours only.`
        }
      />

      <div className="sms-offers">
        <div className="form sms-offers__compose">
          <div className="form__row">
            <Field label="Audience">
              <select className="input" value={audience} onChange={(e) => setAudience(e.target.value as SmsOfferAudience)}>
                {(Object.keys(AUDIENCE_LABEL) as SmsOfferAudience[]).map((a) => (
                  <option key={a} value={a}>
                    {AUDIENCE_LABEL[a]}
                  </option>
                ))}
              </select>
            </Field>
            {multilingual ? (
              <Field label="Customers without a language get">
                <select className="input" value={input.fallback_language} onChange={(e) => setFallback(e.target.value as SmsLanguage)}>
                  {enabled.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          <Field label="Send test to" hint="The mobile number test SMS go to, e.g. 077 123 4567.">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="077 123 4567"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
          </Field>

          {enabled.map((lang) => (
            <OfferText
              key={lang}
              language={lang}
              value={texts[lang]}
              testPhone={testPhone}
              onChange={(value) => setTexts((t) => ({ ...t, [lang]: value }))}
            />
          ))}
        </div>

        <aside className="panel sms-offers__estimate" aria-label="Estimate">
          <h2 className="panel__title">Who gets it</h2>
          {estimate === null ? (
            <Spinner label="Counting customers" />
          ) : 'error' in estimate ? (
            <p className="field__error">{estimate.error}</p>
          ) : (
            <EstimateFigures
              estimate={estimate.data}
              fallback={input.fallback_language}
              stale={estimate.key !== key}
              multilingual={multilingual}
            />
          )}

          {current && current.missing_languages.length > 0 ? (
            <p className="sms-offers__warning" role="alert">
              Write the {languageList(current.missing_languages)} text: some customers in this audience get{' '}
              {current.missing_languages.length === 1 ? 'that language' : 'those languages'}.
            </p>
          ) : null}
          {current && current.recipients === 0 ? <p className="sms-offers__warning">No customer in this audience can receive offers.</p> : null}
          {sendError ? (
            <p className="field__error" role="alert">
              {sendError}
            </p>
          ) : null}

          <button type="button" className="button sms-offers__send" disabled={!canSend} onClick={() => setConfirming(true)}>
            {sending ? <Spinner label="Sending offer" /> : 'Send offer'}
          </button>
        </aside>
      </div>

      <h2 className="section-label sms-offers__history-title">Sent offers</h2>
      {historyError ? <p className="field__error">{historyError}</p> : null}
      {history === null ? (
        <Spinner label="Loading sent offers" />
      ) : history.length === 0 ? (
        historyError ? null : <EmptyState title="No offers sent yet" />
      ) : (
        <OfferHistory offers={history} />
      )}

      {confirming && current ? (
        <ConfirmDialog
          title="Send offer"
          message={`Send to ${current.recipients} ${current.recipients === 1 ? 'customer' : 'customers'}, about ${current.sms_parts_total} SMS parts?`}
          confirmLabel="Send"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      ) : null}
    </>
  );
}

/** One language's text: counter, preview, and a test send. */
function OfferText({
  language,
  value,
  testPhone,
  onChange,
}: {
  language: SmsLanguage;
  value: string;
  /** "Send test to"; blank means the account's own phone (the API refuses if it has none). */
  testPhone: string;
  onChange(value: string): void;
}) {
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);
  const name = LANGUAGE_LABEL[language];
  const parts = offerParts(value, language);

  async function sendTest() {
    const phone = testPhone.trim();
    if (phone && !TEST_PHONE_PATTERN.test(phone.replace(/[\s\-()]/g, ''))) {
      setTestNote({ ok: false, text: 'Enter a Sri Lankan mobile number, e.g. 077 123 4567.' });
      return;
    }
    setTesting(true);
    setTestNote(null);
    try {
      const result = await smsOffersApi.test(language, value.trim(), phone || undefined);
      setTestNote({ ok: true, text: `Test sent to ${result.sent_to}` });
    } catch (err) {
      setTestNote({ ok: false, text: smsOfferErrorMessage(err, 'Could not send the test.') });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="form__section sms-offers__lang" aria-label={`${name} offer`}>
      <Field label={name}>
        <textarea
          className="input"
          rows={3}
          aria-label={`${name} text`}
          maxLength={MAX_OFFER_TEXT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <p className="form__note" data-testid={`count-${language}`}>
        {value.length} / {MAX_OFFER_TEXT} characters{parts ? ` · ${partsLabel(parts)} with the opt-out line` : ''}
      </p>
      {value.trim() ? (
        <div className="preview">
          <p className="preview__label">Customers receive</p>
          <p className="sms-offers__preview" aria-label={`${name} preview`}>
            {value.trim()}
          </p>
        </div>
      ) : null}
      <div className="row-actions sms-offers__test">
        <button
          type="button"
          className="button button--ghost button--sm"
          aria-label={`Send ${name} test`}
          disabled={!value.trim() || testing}
          onClick={() => void sendTest()}
        >
          {testing ? 'Sending…' : 'Send test'}
        </button>
        {testNote ? (
          <span className={testNote.ok ? 'form__note' : 'field__error'} role="status">
            {testNote.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function EstimateFigures({
  estimate,
  fallback,
  stale,
  multilingual,
}: {
  estimate: SmsOfferEstimate;
  fallback: SmsLanguage;
  stale: boolean;
  /** With one language on, everyone gets it: no per-language breakdown. */
  multilingual: boolean;
}) {
  return (
    <dl className={stale ? 'sms-offers__figures is-stale' : 'sms-offers__figures'} aria-busy={stale}>
      <div>
        <dt>Recipients</dt>
        <dd className="mono">{estimate.recipients}</dd>
      </div>
      {multilingual ? (
        <>
          {SMS_LANGUAGES.filter((l) => estimate.languages?.includes(l) ?? true).map((l) => (
            <div key={l}>
              <dt>{LANGUAGE_LABEL[l]}</dt>
              <dd className="mono">{estimate.by_language[l]}</dd>
            </div>
          ))}
          <div>
            <dt>No language (get {LANGUAGE_LABEL[fallback]})</dt>
            <dd className="mono">{estimate.without_language}</dd>
          </div>
        </>
      ) : null}
      <div>
        <dt>Opted out</dt>
        <dd className="mono">{estimate.opted_out}</dd>
      </div>
      <div>
        <dt>SMS parts</dt>
        <dd className="mono">{estimate.sms_parts_total}</dd>
      </div>
    </dl>
  );
}

const MESSAGE_KEY: Record<SmsLanguage, 'message_si' | 'message_ta' | 'message_en'> = {
  si: 'message_si',
  ta: 'message_ta',
  en: 'message_en',
};

function OfferHistory({ offers }: { offers: SmsOffer[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="table-wrap">
      <table className="table" aria-label="Sent offers">
        <thead>
          <tr>
            <th scope="col">Sent</th>
            <th scope="col">Sent by</th>
            <th scope="col">Audience</th>
            <th scope="col" className="num">
              Recipients
            </th>
            <th scope="col" className="num">
              SMS parts
            </th>
            <th scope="col">Text</th>
            <th scope="col">
              <span className="visually-hidden">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const open = openId === o.id;
            const written = SMS_LANGUAGES.filter((l) => o[MESSAGE_KEY[l]]);
            const first = written[0];
            return (
              <Fragment key={o.id}>
                <tr>
                  <td className="cell__secondary">
                    {formatDay(o.created_at)} {formatClock(o.created_at)}
                  </td>
                  <td>{o.sent_by_name ?? '—'}</td>
                  <td>{AUDIENCE_LABEL[o.audience] ?? o.audience}</td>
                  <td className="num mono">{o.recipient_count}</td>
                  <td className="num mono">{o.sms_parts_total}</td>
                  <td className="cell__secondary sms-offers__snippet">
                    {first ? `${LANGUAGE_LABEL[first]}: ${o[MESSAGE_KEY[first]]}` : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} texts of the offer sent ${formatDay(o.created_at)} ${formatClock(o.created_at)}`}
                      onClick={() => setOpenId(open ? null : o.id)}
                    >
                      {open ? 'Hide' : 'Texts'}
                    </button>
                  </td>
                </tr>
                {open ? (
                  <tr className="order-expand">
                    <td colSpan={7}>
                      <dl className="sms-offers__texts">
                        {written.map((l) => (
                          <div key={l}>
                            <dt>
                              {LANGUAGE_LABEL[l]}
                              {l === o.fallback_language ? ' (fallback)' : ''}
                            </dt>
                            <dd>{o[MESSAGE_KEY[l]]}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
