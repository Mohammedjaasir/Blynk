import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { PageHeader } from '../components/Layout';
import { Field, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';

/**
 * Notifications (owner, 2026-10-19: "I must be able to send notifications to the people who
 * installed like store is open now, start ordering" - Admin, the backup admin and the Ops app):
 * one push to every customer who allowed notifications. Ported from
 * apps/admin/src/pages/Notifications.tsx (same wording and limits).
 */
interface BroadcastAudience { push_enabled: boolean; customers: number; devices: number }
interface SentBroadcast { id: string; title: string; body: string; queued: number; sent_at: string; sent_by: string | null }

const LIMITS = { title: 60, body: 180 } as const;
const STORE_OPEN = { title: 'Blynk is open now!', body: 'Fresh groceries are ready. Start ordering now and we will deliver to your door.' };

const api = {
  audience: () => apiRequest<BroadcastAudience>('/admin/push-broadcasts/audience'),
  list: () => apiRequest<{ broadcasts: SentBroadcast[] }>('/admin/push-broadcasts').then((d) => d.broadcasts),
  send: (body: { title: string; body: string }) => apiRequest<{ id: string; queued: number }>('/admin/push-broadcasts', { method: 'POST', body }),
};

export function Notifications() {
  const [audience, setAudience] = useState<BroadcastAudience | null>(null);
  const [history, setHistory] = useState<SentBroadcast[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.audience().then(setAudience).catch((err) => setError(errorMessage(err, 'Could not load who will get it.')));
    void api.list().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(load, [load]);

  const t = title.trim();
  const b = body.trim();
  const problem = t.length < 2 || b.length < 2 || t.length > LIMITS.title || b.length > LIMITS.body;
  const canSend = !!audience?.push_enabled && audience.customers > 0 && !problem && !sending;

  async function send() {
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      const r = await api.send({ title: t, body: b });
      setNotice(`Sent to ${r.queued} customer${r.queued === 1 ? '' : 's'}.`);
      setConfirming(false);
      setTitle('');
      setBody('');
      load();
    } catch (err) {
      setError(errorMessage(err, 'Could not send the notification.'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Notifications" description="Send a notification to every customer who allowed notifications in the Blynk app, e.g. when the store opens." />
      {notice ? (
        <p className="form__note" role="status">
          {notice}
        </p>
      ) : null}

      <section className="form__section" aria-label="Who gets it">
        <h2 className="form__section-title">Who gets it</h2>
        {!audience ? (
          <Spinner label="Loading" />
        ) : !audience.push_enabled ? (
          <p className="field__error" role="alert">
            Push notifications are not set up on the server yet (FIREBASE_SERVICE_ACCOUNT_JSON in Coolify), so nothing can be sent.
          </p>
        ) : (
          <p className="form__note" data-testid="audience">
            {audience.customers} customer{audience.customers === 1 ? '' : 's'} ({audience.devices} device{audience.devices === 1 ? '' : 's'}) allowed
            notifications.
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
        </section>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        {confirming ? (
          <div className="form__actions" role="alertdialog" aria-label="Confirm sending">
            <span>
              Send this to {audience?.customers ?? 0} customer{audience?.customers === 1 ? '' : 's'} now? It cannot be undone.
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
              <div className="field__hint">
                {new Date(h.sent_at).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' })} · {h.queued} customer
                {h.queued === 1 ? '' : 's'}
                {h.sent_by ? ` · by ${h.sent_by}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
