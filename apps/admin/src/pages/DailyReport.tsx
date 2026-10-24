import { useCallback, useEffect, useState } from 'react';
import { dailyReport as dailyReportApi } from '../api/resources';
import { PageHeader } from '../components/Layout';
import { Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import {
  MAX_REPORT_PHONES,
  REPORT_MAX_CHARS,
  clockLabel,
  cooldownLeft,
  isValidSendAt,
  lastSentText,
  normalizeLkPhone,
  partsLabel,
  phoneProblem,
  readableLkPhone,
  reportParts,
  reportPayload,
  sameDraft,
  type DailyReportPreview,
  type DailyReportSetting,
} from '../lib/dailyReport';

/**
 * Daily report (owner, 2026-10-25: "the 9 pm daily report"). One short SMS every evening to up to
 * five numbers: orders, sales, cash collected, average basket, new customers, top products, low
 * stock, ratings. Switch it on, choose the time and the numbers, read today's text, or send it
 * now. Blynk Ops has the same page (More -> Daily report).
 */
export function DailyReport() {
  const toast = useToast();
  const [saved, setSaved] = useState<DailyReportSetting | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [sendAt, setSendAt] = useState('21:00');
  const [phones, setPhones] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DailyReportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const adopt = useCallback((s: DailyReportSetting) => {
    setSaved(s);
    setEnabled(s.enabled);
    setSendAt(s.send_at);
    setPhones(s.phones);
  }, []);

  const refreshPreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(await dailyReportApi.preview());
    } catch (err) {
      setPreviewError(errorMessage(err, 'Could not build the report.'));
    } finally {
      setPreviewing(false);
    }
  }, []);

  useEffect(() => {
    dailyReportApi
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Could not load the daily report.')));
    void refreshPreview();
  }, [adopt, refreshPreview]);

  // Ticks only while the Send now cooldown runs.
  const wait = saved ? cooldownLeft(saved.last_manual_at, now) : 0;
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = { enabled, send_at: sendAt, phones };
  const dirty = saved ? !sameDraft(draft, saved) : false;
  const timeProblem = isValidSendAt(sendAt) ? null : 'Choose a time.';
  const needsNumber = enabled && phones.length === 0;
  const problem = timeProblem ?? (needsNumber ? 'Add at least one number before switching the report on.' : null);

  function addPhone() {
    const p = phoneProblem(newPhone, phones);
    setPhoneError(p);
    if (p) return;
    setPhones((list) => [...list, normalizeLkPhone(newPhone)!]);
    setNewPhone('');
  }

  async function save() {
    setError(null);
    if (problem) return;
    setSaving(true);
    try {
      adopt(await dailyReportApi.update(reportPayload(draft)));
      toast.success('Daily report saved.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save the daily report.'));
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    setSendError(null);
    setSending(true);
    try {
      const sent = await dailyReportApi.sendNow();
      toast.success(`Report sent to ${sent.recipients} number${sent.recipients === 1 ? '' : 's'}.`);
      setPreview(sent);
      setNow(Date.now());
      adopt(await dailyReportApi.get());
    } catch (err) {
      setSendError(errorMessage(err, 'Could not send the report.'));
      void dailyReportApi.get().then(adopt).catch(() => undefined);
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Daily report" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the daily report" />;

  const chars = preview?.chars ?? 0;
  const parts = preview ? reportParts(preview.chars) : 0;

  return (
    <>
      <PageHeader
        title="Daily report"
        description="Every evening one SMS tells you how the day went: orders, sales, cash collected, top products, low stock and ratings."
      />

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="editor__section">
          <h3 className="editor__legend">Settings</h3>
          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Send the daily report</span>
          </label>
          <p className="form__note">
            {enabled ? `Sent once a day from ${clockLabel(sendAt)} (Sri Lanka time).` : 'Off: nothing is sent automatically. You can still use Send now.'} If the
            time is missed it goes out later the same evening, up to 11:30 pm, never the next day.
          </p>
          <label className="field">
            <span className="field__label">Send at</span>
            <input className="input" type="time" aria-label="Send at" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
            <span className="field__hint">Sri Lanka time. Usually 9 pm, after the shop closes.</span>
          </label>
        </section>

        <section className="editor__section" aria-label="Numbers">
          <h3 className="editor__legend">Numbers</h3>
          {phones.length === 0 ? <p className="form__note">No numbers yet. Add up to {MAX_REPORT_PHONES}.</p> : null}
          <div className="band-list">
            {phones.map((p) => (
              <div className="band-list__row" key={p} data-testid="report-phone">
                <span style={{ flex: '1 1 auto' }}>
                  <strong>{readableLkPhone(p)}</strong>
                </span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Remove ${readableLkPhone(p)}`}
                  onClick={() => setPhones((list) => list.filter((x) => x !== p))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="form__row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 220px' }}>
              <span className="field__label">Add a number</span>
              <input
                className="input"
                inputMode="tel"
                autoComplete="off"
                placeholder="077 123 4567"
                aria-label="Add a number"
                value={newPhone}
                disabled={phones.length >= MAX_REPORT_PHONES}
                onChange={(e) => {
                  setNewPhone(e.target.value);
                  setPhoneError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPhone();
                  }
                }}
              />
            </label>
            <button type="button" className="button button--ghost" disabled={phones.length >= MAX_REPORT_PHONES} onClick={addPhone}>
              Add
            </button>
          </div>
          {phoneError ? (
            <p className="field__error" role="alert">
              {phoneError}
            </p>
          ) : null}
        </section>

        {error || problem ? (
          <p className="field__error" role="alert">
            {error ?? problem}
          </p>
        ) : null}
        <div className="band-save-bar">
          <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => adopt(saved)}>
            Discard changes
          </button>
          <button type="submit" className="button" disabled={!dirty || saving || !!problem}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>

      <section className="editor__section" aria-label="Today's report">
        <h3 className="editor__legend">Today so far</h3>
        <p className="form__note">This is what would be sent right now. The real one is built at the send time, with the whole day.</p>
        {preview ? (
          <pre
            data-testid="report-text"
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--canvas)', borderRadius: 'var(--radius)', padding: 12, margin: '8px 0', fontSize: 'var(--text-meta)' }}
          >
            {preview.text}
          </pre>
        ) : previewing ? (
          <Spinner label="Building the report" />
        ) : null}
        {preview ? (
          <p className="field__hint" data-testid="report-count">
            {chars} of {REPORT_MAX_CHARS} characters, {partsLabel(parts)}
          </p>
        ) : null}
        {previewError ? (
          <p className="field__error" role="alert">
            {previewError}
          </p>
        ) : null}
        <div className="band-save-bar">
          <button type="button" className="button button--ghost" disabled={previewing} onClick={() => void refreshPreview()}>
            {previewing ? <Spinner label="Refreshing" /> : 'Refresh'}
          </button>
          <button type="button" className="button" disabled={sending || dirty || phones.length === 0 || wait > 0} onClick={() => void sendNow()}>
            {sending ? <Spinner label="Sending" /> : wait > 0 ? `Send now (${wait}s)` : 'Send now'}
          </button>
        </div>
        {dirty ? <p className="field__hint">Save your changes first: Send now uses the saved numbers.</p> : null}
        {!dirty && saved.phones.length === 0 ? <p className="field__hint">Add and save a number to use Send now.</p> : null}
        {sendError ? (
          <p className="field__error" role="alert">
            {sendError}
          </p>
        ) : null}
        <p className="form__note" data-testid="report-last-sent">
          {lastSentText(saved)}
        </p>
      </section>
    </>
  );
}
