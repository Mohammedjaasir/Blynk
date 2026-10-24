import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { CustomerGroupPicker } from '../components/CustomerGroupPicker';
import { ImageUploader } from '../components/ImageUploader';
import { PageHeader } from '../components/Layout';
import { Field, Spinner } from '../components/ui';
import { audienceFromDraft, audienceLabel, audienceQuery, blankAudienceDraft, type CustomerAudience } from '../lib/customerGroups';
import { errorMessage } from '../lib/errors';

/**
 * Notifications (owner, 2026-10-19: "I must be able to send notifications to the people who
 * installed like store is open now, start ordering" - Admin, the backup admin and the Ops app):
 * one push to every customer who allowed notifications. Ported from
 * apps/admin/src/pages/Notifications.tsx (same wording and limits).
 */
interface BroadcastAudience { push_enabled: boolean; customers: number; devices: number }
/** `audience` (customer groups, 2026-10-24): who it went to; absent/null on older rows = every customer. */
interface SentBroadcast { id: string; title: string; body: string; image_url?: string | null; queued: number; sent_at: string; sent_by: string | null; audience?: CustomerAudience | null }

const LIMITS = { title: 60, body: 180 } as const;
const STORE_OPEN = { title: 'Blynk is open now!', body: 'Fresh groceries are ready. Start ordering now and we will deliver to your door.' };
/** Count again this long after the last change to the group's numbers. */
const COUNT_DELAY_MS = 300;

const api = {
  /** Every customer when left out or ALL (unchanged); else the group's counts. */
  audience: (audience?: CustomerAudience) =>
    apiRequest<BroadcastAudience>(`/admin/push-broadcasts/audience${audience && audience.group !== 'ALL' ? `?${audienceQuery(audience)}` : ''}`),
  list: () => apiRequest<{ broadcasts: SentBroadcast[] }>('/admin/push-broadcasts').then((d) => d.broadcasts),
  send: (body: { title: string; body: string; image_url?: string; audience?: CustomerAudience }) =>
    apiRequest<{ id: string; queued: number }>('/admin/push-broadcasts', { method: 'POST', body }),
};

export function Notifications() {
  // "Send to" (customer groups, 2026-10-24): the live count is tagged with the group it counted.
  const [groupDraft, setGroupDraft] = useState(blankAudienceDraft);
  const built = audienceFromDraft(groupDraft);
  const groupKey = built.audience ? audienceQuery(built.audience) : '';
  const [counted, setCounted] = useState<{ key: string; data: BroadcastAudience } | null>(null);
  const firstCount = useRef(true);
  const [history, setHistory] = useState<SentBroadcast[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Bumped after a send so the count is read again.
  const [recount, setRecount] = useState(0);
  const loadHistory = useCallback(() => {
    void api.list().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  // Count the chosen group: at once on open, then shortly after the last change.
  useEffect(() => {
    const target = audienceFromDraft(groupDraft).audience;
    if (!target) return undefined;
    let live = true;
    const timer = setTimeout(
      () => {
        api
          .audience(target)
          .then((data) => {
            if (!live) return;
            setCounted({ key: groupKey, data });
            setError(null);
          })
          .catch((err) => live && setError(errorMessage(err, 'Could not load who will get it.')));
      },
      firstCount.current ? 0 : COUNT_DELAY_MS
    );
    firstCount.current = false;
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // groupKey stands for the draft's audience.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, recount]);

  const audience = counted?.data ?? null;
  const countIsCurrent = !!counted && !!built.audience && counted.key === groupKey;

  const t = title.trim();
  const b = body.trim();
  const problem = t.length < 2 || b.length < 2 || t.length > LIMITS.title || b.length > LIMITS.body;
  const canSend = !!audience?.push_enabled && countIsCurrent && audience.customers > 0 && !problem && !sending;

  async function send() {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const target = built.audience;
      const r = await api.send({
        title: t,
        body: b,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        // Every customer: no `audience` at all, the request an older API also takes.
        ...(target && target.group !== 'ALL' ? { audience: target } : {}),
      });
      setNotice(`Sent to ${r.queued} customer${r.queued === 1 ? '' : 's'}.`);
      setConfirming(false);
      setTitle('');
      setBody('');
      setImageUrl(null);
      setRecount((n) => n + 1);
      loadHistory();
    } catch (err) {
      setError(errorMessage(err, 'Could not send the notification.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Notifications" description="Send a notification to customers who allowed notifications in the Blynk app - everyone or a group - e.g. when the store opens." />
      {notice ? (
        <p className="form__note" role="status">
          {notice}
        </p>
      ) : null}

      <section className="form__section" aria-label="Who gets it">
        <h2 className="form__section-title">Who gets it</h2>
        {/* Customer groups (2026-10-24): all, lapsed, new, big spenders, never ordered. */}
        <CustomerGroupPicker name="push-audience" draft={groupDraft} onChange={setGroupDraft} />
        {!built.audience ? null : !audience || !countIsCurrent ? (
          <Spinner label="Counting customers" />
        ) : !audience.push_enabled ? (
          <p className="field__error" role="alert">
            Push notifications are not set up on the server yet (FIREBASE_SERVICE_ACCOUNT_JSON in Coolify), so nothing can be sent.
          </p>
        ) : (
          <p className="form__note group-picker__count" data-testid="audience" aria-live="polite">
            {audience.customers} customer{audience.customers === 1 ? '' : 's'} ({audience.devices} device{audience.devices === 1 ? '' : 's'})
            {built.audience.group === 'ALL' ? '' : ` in "${audienceLabel(built.audience)}"`} allowed notifications.
          </p>
        )}
        <p className="field__hint">
          Only customers who allowed notifications while signed in get it. To reach everyone with a phone number, also send an{' '}
          <Link to="/more/sms-offers">SMS offer</Link>.
        </p>
      </section>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) setConfirming(true);
        }}
      >
        <section className="form__section" aria-label="Message">
          <h2 className="form__section-title">Message</h2>
          <div>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => {
                setTitle(STORE_OPEN.title);
                setBody(STORE_OPEN.body);
              }}
            >
              Use &quot;Store is open&quot; message
            </button>
          </div>
          <Field label="Title" hint={`${t.length}/${LIMITS.title}`}>
            <input className="input" aria-label="Title" value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Message" hint={`${b.length}/${LIMITS.body}`}>
            <textarea className="input" aria-label="Message" rows={3} value={body} maxLength={LIMITS.body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <ImageUploader
            value={imageUrl}
            folder="promotions"
            label="Picture (optional)"
            onChange={(url) => setImageUrl(url)}
          />
          <p className="field__hint">A wide picture (2 to 1, e.g. 1200 x 600) works best. It shows under the message on the customer's phone.</p>
          {imageUrl ? <img src={imageUrl} alt="Picture preview" style={{ display: 'block', width: '100%', maxWidth: 360, borderRadius: 8 }} /> : null}
        </section>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        {confirming ? (
          <div className="form__actions" role="alertdialog" aria-label="Confirm sending">
            <span>
              Send this to {audience?.customers ?? 0} customer{audience?.customers === 1 ? '' : 's'}
              {built.audience && built.audience.group !== 'ALL' ? ` (${audienceLabel(built.audience)})` : ''} now? It cannot be undone.
            </span>
            <button type="button" className="button button--ghost" disabled={sending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="button" disabled={sending} onClick={() => void send()}>
              {sending ? <Spinner label="Sending" /> : 'Yes, send'}
            </button>
          </div>
        ) : (
          <div className="form__actions">
            <button type="submit" className="button" disabled={!canSend}>
              Send notification
            </button>
          </div>
        )}
      </form>

      <section className="form__section" aria-label="Sent">
        <h2 className="form__section-title">Sent</h2>
        {history.length === 0 ? <p className="form__note">Nothing sent yet.</p> : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {history.map((h) => (
            <li key={h.id || h.sent_at} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <strong>{h.title}</strong> - {h.body}
              {h.image_url ? <img src={h.image_url} alt="" style={{ display: 'block', height: 48, borderRadius: 6, marginTop: 4 }} /> : null}
              <div className="field__hint">
                {new Date(h.sent_at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' })} · {h.queued} customer
                {h.queued === 1 ? '' : 's'}
                {h.audience && h.audience.group !== 'ALL' ? ` · ${audienceLabel(h.audience)}` : ''}
                {h.sent_by ? ` · by ${h.sent_by}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
