import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { CustomerSmsLanguageMode, CustomerSmsLanguageSetting, SmsLanguageCode } from '../api/types';
import { TierModeChoice } from './KmTierEditor';
import { Spinner } from './ui';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { partsText } from '../lib/sms';

const MODES: ReadonlyArray<{ id: CustomerSmsLanguageMode; text: string }> = [
  { id: 'ENGLISH_ONLY', text: 'English only' },
  { id: 'CUSTOMER_CHOICE', text: "Customer's choice" },
  { id: 'ALWAYS_SINHALA', text: 'Always Sinhala' },
  { id: 'ALWAYS_TAMIL', text: 'Always Tamil' },
];

const NAMES: Record<SmsLanguageCode, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

/**
 * Customer SMS language (owner, 2026-10-12; `GET|PATCH
 * /admin/settings/customer-sms-language`): the language of order texts,
 * sign-in codes, dental and rider texts. English only is the default (the
 * texts as before); "Customer's choice" uses the language the customer picked
 * in the app (Profile > SMS & offers), else the fallback. Offer and birthday
 * SMS keep their own texts. Same setting as Admin > Settings.
 */
export function CustomerSmsLanguageCard() {
  const [current, setCurrent] = useState<CustomerSmsLanguageSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<CustomerSmsLanguageMode>('ENGLISH_ONLY');
  const [fallback, setFallback] = useState<SmsLanguageCode>('en');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: CustomerSmsLanguageSetting) {
    setCurrent(s);
    setMode(s.mode);
    setFallback(s.fallback);
  }

  useEffect(() => {
    settings.customerSmsLanguage
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      show(await settings.customerSmsLanguage.update({ mode, fallback }));
      setNotice('Customer SMS language saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="customer-sms-language-title">
      <h2 className="section-label" id="customer-sms-language-title">
        Customer SMS language
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the customer SMS language" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <TierModeChoice<CustomerSmsLanguageMode> label="Order, sign-in, dental and rider texts go out in" options={MODES} value={mode} onPick={setMode} />
          <label className="field">
            <span className="field__label">If the customer never picked a language</span>
            <select
              className="input"
              value={fallback}
              disabled={mode !== 'CUSTOMER_CHOICE'}
              onChange={(e) => setFallback(e.target.value as SmsLanguageCode)}
            >
              {(['en', 'si', 'ta'] as SmsLanguageCode[]).map((l) => (
                <option key={l} value={l}>
                  {NAMES[l]}
                </option>
              ))}
            </select>
          </label>
          <p className="quiet">
            Customers pick their language in the app under Profile &gt; SMS &amp; offers. Sinhala and Tamil cost more (70
            letters per SMS part). Offer and birthday SMS keep their own wording.
          </p>
          {current.samples?.map((s) => (
            <p key={s.lang} className="quiet" aria-label={`${NAMES[s.lang]} sample`}>
              {NAMES[s.lang]} ({partsText(s.parts)}): {s.text}
            </p>
          ))}
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}
