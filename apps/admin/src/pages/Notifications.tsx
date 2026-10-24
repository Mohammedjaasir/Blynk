import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { CustomerGroupPicker } from '../components/CustomerGroupPicker';
import { ImageUploader } from '../components/ImageUploader';
import { PageHeader } from '../components/Layout';
import { Field, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { audienceFromDraft, audienceLabel, audienceQuery, blankAudienceDraft, type CustomerAudience } from '../lib/customerGroups';

/**
 * Notifications (owner, 2026-10-19: "I must be able to send notifications to the people who
 * installed like store is open now, start ordering"): one push to every customer who allowed
 * notifications in the app. Blynk Ops has the same page.
 */
export interface BroadcastAudience { push_enabled: boolean; customers: number; devices: number }
/** `audience` (2026-10-24 customer groups): who it went to; absent/null on older rows = every customer. */
export interface SentBroadcast { id: string; title: string; body: string; image_url?: string | null; queued: number; sent_at: string; sent_by: string | null; audience?: CustomerAudience | null }

export const BROADCAST_LIMITS = { title: 60, body: 180 } as const;
/** One tap fills the store-open message. */
export const STORE_OPEN_TEMPLATE = { title: 'Blynk is open now!', body: 'Fresh groceries are ready. Start ordering now and we will deliver to your door.' };

export const pushBroadcasts = {
  /** Every customer when `audience` is left out or ALL (unchanged); else the group's counts. */
  audience: (audience?: CustomerAudience) =>
    apiRequest<BroadcastAudience>(
      `/admin/push-broadcasts/audience${audience && audience.group !== 'ALL' ? `?${audienceQuery(audience)}` : ''}`
    ),
  list: () => apiRequest<{ broadcasts: SentBroadcast[] }>('/admin/push-broadcasts').then((d) => d.broadcasts),
  send: (body: { title: string; body: string; image_url?: string; audience?: CustomerAudience }) =>
    apiRequest<{ id: string; queued: number }>('/admin/push-broadcasts', { method: 'POST', body }),
};

/** Wait this long after the last change to the group before counting again. */
const COUNT_DELAY_MS = 300;

export function Notifications() {
  const toast = useToast();
  // The live count for the chosen group, tagged with the group it was counted for.
  const [counted, setCounted] = useState<{ key: string; data: BroadcastAudience } | null>(null);
  const [history, setHistory] = useState<SentBroadcast[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Send to" (customer groups, 2026-10-24).
  const [groupDraft, setGroupDraft] = useState(blankAudienceDraft);
  const built = useMemo(() => audienceFromDraft(groupDraft), [groupDraft]);
  const groupKey = built.audience ? audienceQuery(built.audience) : '';
  const [recount, setRecount] = useState(0);
  const firstCount = useRef(true);

  const loadHistory = useCallback(() => {
    void pushBroadcasts.list().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  // Count the chosen group: at once on load, then shortly after the last change.
  useEffect(() => {
    if (!built.audience) return;
    const audience = built.audience;
    let live = true;
    const timer = setTimeout(
      () => {
        pushBroadcasts
          .audience(audience)
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
    // groupKey stands for built.audience.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, recount]);

  const audience = counted?.data ?? null;
  const countIsCurrent = !!counted && counted.key === groupKey && !!built.audience;

  const t = title.trim();
  const b = body.trim();
  const problem =
    t.length < 2 ? 'Write a title.' : b.length < 2 ? 'Write the message.' : t.length > BROADCAST_LIMITS.title || b.length > BROADCAST_LIMITS.body ? 'Too long.' : null;
  const canSend = !!audience?.push_enabled && countIsCurrent && audience.customers > 0 && !problem && !sending;

  async function send() {
    setError(null);
    setSending(true);
    try {
      const target = built.audience;
      const r = await pushBroadcasts.send({
        title: t,
        body: b,
        ...(imageUrl ? { image_url: imageUrl } : {}),
        // Left out for every customer, so an older API behaves the same.
        ...(target && target.group !== 'ALL' ? { audience: target } : {}),
      });
      toast.success(`Sent to ${r.queued} customer${r.queued === 1 ? '' : 's'}.`);
      setConfirming(false);
      setTitle('');
      setBody('');
      setImageUrl(null);
      loadHistory();
      setRecount((n) => n + 1);
    } catch (err) {
      setError(errorMessage(err, 'Could not send the notification.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Send a notification to every customer who allowed notifications in the Blynk app, e.g. when the store opens."
      />
      <section className="form__section" aria-label="Who gets it">
        <h2 className="form__section-title">Who gets it</h2>
        {audience && !audience.push_enabled ? (
          <p className="field__error" role="alert">
            Push notifications are not set up on the server yet (FIREBASE_SERVICE_ACCOUNT_JSON in Coolify), so nothing can be sent.
          </p>
        ) : null}
        <CustomerGroupPicker
          value={groupDraft}
          onChange={setGroupDraft}
          count={
            !audience ? (
              <Spinner label="Loading" />
            ) : !audience.push_enabled ? null : (
              <span data-testid="audience" className={countIsCurrent ? undefined : 'is-stale'} aria-busy={!countIsCurrent}>
                {audience.customers} customer{audience.customers === 1 ? '' : 's'} ({audience.devices} device{audience.devices === 1 ? '' : 's'})
                {groupDraft.group === 'ALL' ? '' : ' in this group'} allowed notifications.
              </span>
            )
          }
        />
        <p className="field__hint">
          Only customers who allowed notifications while signed in get it. To reach everyone with a phone number, also send an{' '}
          <Link to="/sms-offers">SMS offer</Link>.
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
                setTitle(STORE_OPEN_TEMPLATE.title);
                setBody(STORE_OPEN_TEMPLATE.body);
              }}
            >
              Use &quot;Store is open&quot; message
            </button>
          </div>
          <Field label="Title" hint={`${t.length}/${BROADCAST_LIMITS.title}`}>
            <input className="input" aria-label="Title" value={title} maxLength={BROADCAST_LIMITS.title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Message" hint={`${b.length}/${BROADCAST_LIMITS.body}`}>
            <textarea className="input" aria-label="Message" rows={3} value={body} maxLength={BROADCAST_LIMITS.body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <ImageUploader
            value={imageUrl}
            folder="promotions"
            label="Picture (optional)"
            onChange={(url) => setImageUrl(url)}
          />
          <p className="field__hint">A wide picture (2 to 1, e.g. 1200 x 600) works best. It shows under the message on the customer's phone.</p>
          {t || b ? (
            <div className="form__note" aria-label="Preview" style={{ border: '1px solid #e5e5ea', borderRadius: 12, padding: 12, maxWidth: 360 }}>
              <strong>{t || 'Title'}</strong>
              <div>{b || 'Message'}</div>
              {imageUrl ? <img src={imageUrl} alt="" style={{ display: 'block', width: '100%', borderRadius: 8, marginTop: 8 }} /> : null}
            </div>
          ) : null}
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
                <span data-testid="sent-group"> · {audienceLabel(h.audience)}</span>
                {h.sent_by ? ` · by ${h.sent_by}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
