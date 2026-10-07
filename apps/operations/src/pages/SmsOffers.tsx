import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { smsOffers } from '../api/resources';
import type { SmsLanguage, SmsOffer, SmsOfferAudience, SmsOfferEstimate, SmsOfferInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/inventory';
import {
  AUDIENCE_LABEL,
  LANGUAGE_LABEL,
  MAX_OFFER_TEXT,
  SMS_LANGUAGES,
  languageNames,
  partsText,
  smsParts,
  withOptOut,
} from '../lib/sms';

/**
 * More -> SMS offers (owner, 2026-10-06). Admin and Operations write an
 * offer in Sinhala, Tamil and/or English and send it to a group of
 * customers. The backend is the real guard: it picks each customer's
 * language (or the fallback), skips customers who turned offers off, adds
 * the opt-out line and only sends 8 AM - 9 PM. This screen shows the cost
 * while typing (a debounced estimate) and asks before sending.
 *
 * Which languages can be written comes from the backend (`estimate.languages`,
 * English only at launch). Only those get a text box, and the fallback
 * choice appears only when there is more than one.
 */

const AUDIENCES: SmsOfferAudience[] = ['ALL', 'ORDERED_30D', 'ORDERED_90D', 'NEVER_ORDERED'];
const ESTIMATE_DELAY_MS = 400;
const HISTORY_PREVIEW = 80;

/** Before the first estimate answers: the launch setting. */
const DEFAULT_LANGUAGES: SmsLanguage[] = ['en'];

const EMPTY_TEXTS: Record<SmsLanguage, string> = { si: '', ta: '', en: '' };

/** The operator's words for this screen's error codes. */
function offerErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'OUTSIDE_SENDING_HOURS':
        return 'Offers can be sent from 8 AM to 9 PM only.';
      case 'OFFER_NO_RECIPIENTS':
        return 'No customer in this group can get offers.';
      case 'OFFER_TEXT_MISSING': {
        const missing = (err.details as { missing_languages?: SmsLanguage[] } | undefined)?.missing_languages;
        return missing?.length ? `Write the ${languageNames(missing)} text first.` : 'Write the missing text first.';
      }
    }
  }
  return errorMessage(err, fallback);
}

/** Sri Lankan mobile, as the API's normaliser accepts it (070-078, not 073). */
const PHONE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;
const tidyPhone = (phone: string) => phone.replace(/[\s\-()]/g, '');

const truncate = (text: string) => (text.length > HISTORY_PREVIEW ? `${text.slice(0, HISTORY_PREVIEW - 1)}…` : text);

export function SmsOffers() {
  const { user } = useAuth();
  // Tests go to this number; it starts as the operator's own phone (if the
  // account has one) and, left blank, the API falls back to that phone.
  const [testPhone, setTestPhone] = useState(user?.phone ?? '');
  const testPhoneId = useId();
  const [audience, setAudience] = useState<SmsOfferAudience>('ALL');
  const [chosenFallback, setFallback] = useState<SmsLanguage>('en');
  const [languages, setLanguages] = useState<SmsLanguage[]>(DEFAULT_LANGUAGES);
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(EMPTY_TEXTS);
  const [estimate, setEstimate] = useState<SmsOfferEstimate | null>(null);
  const [estimating, setEstimating] = useState(true);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<SmsOffer[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const fallbackId = useId();
  const latestEstimate = useRef(0);

  // Keep the backend's order-independent list in our own si/ta/en order.
  const enabled = SMS_LANGUAGES.filter((l) => languages.includes(l));
  const multilingual = enabled.length > 1;
  const fallback: SmsLanguage = enabled.includes(chosenFallback) ? chosenFallback : enabled[0] ?? 'en';

  const input: SmsOfferInput = {
    audience,
    fallback_language: fallback,
    messages: Object.fromEntries(
      enabled.filter((l) => texts[l].trim()).map((l) => [l, texts[l].trim()])
    ) as SmsOfferInput['messages'],
  };
  const inputKey = JSON.stringify(input);

  // A fresh estimate shortly after the operator stops typing; only the
  // newest answer is kept.
  useEffect(() => {
    const id = ++latestEstimate.current;
    setEstimating(true);
    const timer = setTimeout(() => {
      smsOffers
        .estimate(JSON.parse(inputKey) as SmsOfferInput)
        .then((result) => {
          if (id !== latestEstimate.current) return;
          setEstimate(result);
          setEstimateError(null);
          if (result.languages?.length) {
            setLanguages((current) =>
              current.length === result.languages.length && current.every((l) => result.languages.includes(l))
                ? current
                : result.languages
            );
          }
        })
        .catch((err) => {
          if (id !== latestEstimate.current) return;
          setEstimate(null);
          setEstimateError(offerErrorMessage(err, 'Could not count the customers.'));
        })
        .finally(() => {
          if (id === latestEstimate.current) setEstimating(false);
        });
    }, ESTIMATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [inputKey]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await smsOffers.list());
      setHistoryError(null);
    } catch (err) {
      setHistoryError(errorMessage(err, 'Could not load past offers.'));
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const tooLong = enabled.some((l) => texts[l].length > MAX_OFFER_TEXT);
  const missing = estimate?.missing_languages ?? [];
  const canSend =
    !!estimate && !estimating && !sending && !tooLong && missing.length === 0 && estimate.recipients > 0;

  async function send() {
    setConfirming(false);
    setSending(true);
    setSendError(null);
    setNotice(null);
    try {
      const offer = await smsOffers.send(input);
      setNotice(`Offer sent to ${offer.recipients} customers (${offer.sms_parts_total} SMS parts).`);
      setTexts(EMPTY_TEXTS);
      void loadHistory();
    } catch (err) {
      setSendError(offerErrorMessage(err, 'Could not send the offer.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="SMS offers" description="Send an offer by SMS to your customers." />

      {notice ? (
        <div className="banner staff-notice" role="status">
          <p>{notice}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="card">
        <fieldset className="choice">
          <legend className="field__label">Send to</legend>
          {AUDIENCES.map((a) => (
            <label key={a} className={`choice__option sms-choice${audience === a ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="sms-offer-audience"
                value={a}
                checked={audience === a}
                onChange={() => setAudience(a)}
              />
              <span>
                <strong>{AUDIENCE_LABEL[a]}</strong>
              </span>
            </label>
          ))}
        </fieldset>

        {multilingual ? (
          <div className="field">
            <span className="field__label" id={fallbackId}>
              Customers without a language get:
            </span>
            <div className="segmented sms-segmented" role="group" aria-labelledby={fallbackId}>
              {enabled.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`segmented__item${fallback === l ? ' is-selected' : ''}`}
                  aria-pressed={fallback === l}
                  onClick={() => setFallback(l)}
                >
                  {LANGUAGE_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="field">
          <label className="field__label" htmlFor={testPhoneId}>
            Send test to
          </label>
          <input
            id={testPhoneId}
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="077 123 4567"
            value={testPhone}
            onChange={(event) => setTestPhone(event.target.value)}
          />
          <span className="field__hint">A mobile number for test texts. Leave it empty to use your own.</span>
        </div>
      </section>

      {enabled.map((language) => (
        <OfferText
          key={language}
          language={language}
          testPhone={testPhone}
          value={texts[language]}
          customers={multilingual ? estimate?.by_language[language] : undefined}
          onChange={(value) => setTexts((current) => ({ ...current, [language]: value }))}
        />
      ))}

      <section className="card" aria-labelledby="sms-estimate-title" aria-busy={estimating}>
        <h2 className="section-label" id="sms-estimate-title">
          Who gets it
        </h2>
        {estimate ? (
          <>
            <p className="card__row">
              <span className="card__label">Customers</span>
              <span className="card__value mono" data-testid="sms-recipients">
                {estimate.recipients}
              </span>
            </p>
            {multilingual ? (
              <>
                {enabled.map((l) => (
                  <p key={l} className="card__row">
                    <span className="card__label">In {LANGUAGE_LABEL[l]}</span>
                    <span className="card__value mono">{estimate.by_language[l]}</span>
                  </p>
                ))}
                <p className="card__row">
                  <span className="card__label">No language picked (get {LANGUAGE_LABEL[fallback]})</span>
                  <span className="card__value mono">{estimate.without_language}</span>
                </p>
              </>
            ) : null}
            <p className="card__row">
              <span className="card__label">Turned offers off</span>
              <span className="card__value mono">{estimate.opted_out}</span>
            </p>
            <p className="card__row">
              <span className="card__label">SMS parts in total</span>
              <span className="card__value mono" data-testid="sms-parts-total">
                {estimate.sms_parts_total}
              </span>
            </p>
          </>
        ) : estimateError ? (
          <p className="field__error" role="alert">
            {estimateError}
          </p>
        ) : (
          <Spinner label="Counting customers" />
        )}
        {missing.length > 0 ? (
          <p className="banner" role="alert">
            Write the {languageNames(missing)} text: {missing.map((l) => `${estimate!.by_language[l]} customers get ${LANGUAGE_LABEL[l]}`).join(', ')}.
          </p>
        ) : null}
        {estimate && estimate.recipients === 0 ? (
          <p className="banner banner--muted">No customer in this group can get offers.</p>
        ) : null}
      </section>

      {sendError ? (
        <p className="field__error" role="alert">
          {sendError}
        </p>
      ) : null}

      <button type="button" className="primary sms-send" disabled={!canSend} onClick={() => setConfirming(true)}>
        {sending ? <Spinner label="Sending offer" /> : 'Send offer'}
      </button>
      <p className="page__note">Offers go out from 8 AM to 9 PM only. Each SMS ends with how to stop offers.</p>

      {confirming && estimate ? (
        <ConfirmDialog
          title="Send offer"
          message={`Send to ${estimate.recipients} customers, about ${estimate.sms_parts_total} SMS parts?`}
          confirmLabel="Send"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      ) : null}

      <section className="section" aria-labelledby="sms-history-title">
        <h2 className="section-label" id="sms-history-title">
          Recent offers
        </h2>
        {historyError ? (
          <p className="field__error" role="alert">
            {historyError}
          </p>
        ) : null}
        {history === null ? (
          <Spinner label="Loading past offers" />
        ) : history.length === 0 ? (
          historyError ? null : <EmptyState title="No offers sent yet" />
        ) : (
          <ul className="cat-list" aria-label="Recent offers">
            {history.map((offer) => (
              <li key={offer.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">{AUDIENCE_LABEL[offer.audience] ?? offer.audience}</p>
                  <p className="cat-row__meta">
                    {formatDateTime(offer.created_at)} · {offer.sent_by_name ?? offer.sent_by_role ?? 'Unknown'}
                  </p>
                  <p className="cat-row__meta">
                    {offer.recipient_count} customers · {offer.sms_parts_total} SMS parts
                  </p>
                  {SMS_LANGUAGES.map((l) => {
                    const text = offer[`message_${l}`];
                    return text ? (
                      <p key={l} className="cat-row__meta sms-history__text">
                        <strong>{LANGUAGE_LABEL[l]}:</strong> {truncate(text)}
                      </p>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One language's text box: count, cost, preview and a test send. */
function OfferText({
  language,
  testPhone,
  value,
  customers,
  onChange,
}: {
  language: SmsLanguage;
  /** Where the test goes; blank means the operator's own phone. */
  testPhone: string;
  value: string;
  customers: number | undefined;
  onChange(value: string): void;
}) {
  const id = useId();
  const countId = useId();
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const name = LANGUAGE_LABEL[language];
  const text = value.trim();
  const finalSms = text ? withOptOut(text, language) : '';
  const tooLong = value.length > MAX_OFFER_TEXT;

  async function sendTest() {
    setTestNotice(null);
    setTestError(null);
    const phone = tidyPhone(testPhone.trim());
    if (phone && !PHONE_PATTERN.test(phone)) {
      setTestError('Enter a Sri Lankan mobile number to send the test to, e.g. 077 123 4567.');
      return;
    }
    setTesting(true);
    try {
      const result = await smsOffers.test(language, text, phone || undefined);
      setTestNotice(`Test sent to ${result.sent_to}`);
    } catch (err) {
      setTestError(offerErrorMessage(err, 'Could not send the test.'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="card sms-text">
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {name} text{customers !== undefined ? ` · ${customers} customers` : ''}
        </label>
        <textarea
          id={id}
          className="input"
          rows={4}
          maxLength={MAX_OFFER_TEXT}
          value={value}
          aria-describedby={countId}
          aria-invalid={tooLong ? true : undefined}
          onChange={(event) => {
            onChange(event.target.value);
            setTestNotice(null);
            setTestError(null);
          }}
        />
        <span id={countId} className="field__hint" data-testid={`sms-count-${language}`}>
          {value.length}/{MAX_OFFER_TEXT} characters
          {text ? ` · ${partsText(smsParts(finalSms))} with the stop line` : ''}
        </span>
      </div>
      {finalSms ? (
        <div className="sms-preview" aria-label={`${name} SMS preview`}>
          {finalSms}
        </div>
      ) : null}
      <button
        type="button"
        className="button sms-test"
        aria-label={`Send ${name} test`}
        disabled={!text || tooLong || testing}
        onClick={() => void sendTest()}
      >
        {testing ? <Spinner label="Sending test" /> : 'Send test'}
      </button>
      {testNotice ? (
        <p className="quiet quiet--ok" role="status">
          {testNotice}
        </p>
      ) : null}
      {testError ? (
        <p className="field__error" role="alert">
          {testError}
        </p>
      ) : null}
    </section>
  );
}
