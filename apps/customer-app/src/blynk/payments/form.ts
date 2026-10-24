import { ApiError } from '@/blynk/api/client';
import { PAY } from './copy';

/*
 * The PayHere checkout form (docs/api/payhere.md §3): POST /payments/payhere/checkout answers
 * { action_url, method, mode, expires_at, fields }. Every field is posted unchanged as
 * application/x-www-form-urlencoded to action_url; merchant_id, order_id, amount and currency
 * are in the hash and are never touched. Only an empty `email` may be filled in here.
 */

export type CheckoutForm = {
  action_url: string;
  method: 'POST';
  mode: string;
  expires_at: string | null;
  fields: Record<string, string>;
};

/** What PayHere needs to accept the post (the server always sends these). */
export const REQUIRED_FIELDS = [
  'merchant_id', 'return_url', 'cancel_url', 'notify_url', 'order_id', 'items', 'currency', 'amount', 'hash',
] as const;

/** The fields inside the checkout hash: never changed by the app. */
export const HASHED_FIELDS = ['merchant_id', 'order_id', 'amount', 'currency'] as const;

const PAYHERE_HOSTS = new Set(['sandbox.payhere.lk', 'www.payhere.lk', 'payhere.lk']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function hostOf(url: string): { protocol: string; host: string } | null {
  const m = /^(https?):\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return m ? { protocol: m[1].toLowerCase(), host: m[2].toLowerCase() } : null;
}

/**
 * The form is only ever posted to PayHere over https. A local development API (http://localhost)
 * may point it at a local mock of PayHere; a production build never posts anywhere else.
 */
export function allowedAction(actionUrl: string, apiBase: string): boolean {
  const a = hostOf(actionUrl);
  if (!a) return false;
  if (a.protocol === 'https' && PAYHERE_HOSTS.has(a.host)) return true;
  const api = hostOf(apiBase);
  return !!api && LOCAL_HOSTS.has(api.host) && LOCAL_HOSTS.has(a.host);
}

const bad = (why: string) => new ApiError(`PayHere checkout is not usable: ${why}.`, 500, 'BAD_CHECKOUT');

/** Parse and check the API's answer; throws ApiError('BAD_CHECKOUT') when it cannot be posted. */
export function parseCheckout(raw: unknown, apiBase: string): CheckoutForm {
  const r = (raw ?? {}) as Record<string, unknown>;
  const action = typeof r.action_url === 'string' ? r.action_url : '';
  if (!action || !allowedAction(action, apiBase)) throw bad('unexpected payment page');
  if (r.method !== undefined && String(r.method).toUpperCase() !== 'POST') throw bad('not a POST form');
  const src = (r.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v === null || v === undefined) fields[k] = '';
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') fields[k] = String(v);
  }
  for (const k of REQUIRED_FIELDS) if (!fields[k]) throw bad(`missing ${k}`);
  return {
    action_url: action,
    method: 'POST',
    mode: typeof r.mode === 'string' ? r.mode : 'live',
    expires_at: typeof r.expires_at === 'string' ? r.expires_at : null,
    fields,
  };
}

/** PayHere asks for an email; the server sends '' when the profile has none. */
export const formNeedsEmail = (f: CheckoutForm) => !(f.fields.email ?? '').trim();

/**
 * The name/value pairs to post, in the server's order. An empty email is filled with the one
 * the customer typed; nothing else is changed.
 */
export function formEntries(f: CheckoutForm, email?: string | null): [string, string][] {
  const out: [string, string][] = Object.entries(f.fields).map(([k, v]) => [k, v]);
  const typed = (email ?? '').trim();
  if (typed && formNeedsEmail(f)) {
    const i = out.findIndex(([k]) => k === 'email');
    if (i >= 0) out[i] = ['email', typed];
    else out.push(['email', typed]);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;');

/** A self-submitting page for the native in-app browser (WebView). */
export function formHtml(action: string, entries: [string, string][], label: string = PAY.redirecting): string {
  const inputs = entries.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>PayHere</title></head><body style="font-family:sans-serif;text-align:center;padding-top:40vh;color:#1A1D2E">${esc(label)}`
    + `<form id="f" method="POST" action="${esc(action)}" accept-charset="utf-8">${inputs}</form>`
    + '<script>document.getElementById("f").submit();</script></body></html>';
}

type Doc = Pick<Document, 'createElement' | 'body'>;

/** Web: build a hidden form and POST it to PayHere in this tab (the page leaves the app). */
export function submitWebForm(doc: Doc, action: string, entries: [string, string][]): HTMLFormElement {
  const form = doc.createElement('form');
  form.method = 'POST';
  form.action = action;
  form.target = '_self';
  form.acceptCharset = 'utf-8';
  form.style.display = 'none';
  for (const [k, v] of entries) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  doc.body.appendChild(form);
  form.submit();
  return form;
}

/** Native: is this WebView navigation PayHere sending the customer back (return or cancel)? */
export function returnKind(url: string, f: Pick<CheckoutForm, 'fields'>): 'return' | 'cancel' | null {
  const base = (u: string | undefined) => (u ?? '').split('?')[0].replace(/\/+$/, '');
  const at = base(url);
  if (!at) return null;
  if (f.fields.return_url && at === base(f.fields.return_url)) return 'return';
  if (f.fields.cancel_url && at === base(f.fields.cancel_url)) return 'cancel';
  return null;
}
