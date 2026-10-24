import { ApiError } from '@/blynk/api/client';

/*
 * "Can't find it? Ask us" (migration 056; docs/superpowers/plans/2026-10-24-groups-ratings-requests.md §C):
 * POST /product-requests { name, note?, category_id? } (guests too; 5 a day per customer) and
 * GET /me/product-requests (the customer's own, with their status). No React here.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const NOTE_MAX = 300;

/** Trimmed, inner spaces collapsed. */
export const normalizeName = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** The server's grouping key: lowercase, trimmed, collapsed spaces. */
export const requestKey = (s: string): string => normalizeName(s).toLowerCase();

export interface RequestBody { name: string; note?: string; category_id?: string }

export type RequestCheck =
  | { ok: true; body: RequestBody }
  | { ok: false; field: 'name' | 'note'; error: string };

export function validateRequest(input: { name: string; note?: string | null; categoryId?: string | null }): RequestCheck {
  const name = normalizeName(input.name ?? '');
  if (name.length < NAME_MIN) return { ok: false, field: 'name', error: 'Tell us the product name.' };
  if (name.length > NAME_MAX) return { ok: false, field: 'name', error: `Keep the name under ${NAME_MAX} characters.` };
  const note = (input.note ?? '').trim();
  if (note.length > NOTE_MAX) return { ok: false, field: 'note', error: `Keep the note under ${NOTE_MAX} characters.` };
  const cat = (input.categoryId ?? '').trim();
  return { ok: true, body: { name, ...(note ? { note } : {}), ...(cat ? { category_id: cat } : {}) } };
}

/** A search term worth carrying into the sheet as the name (cut to fit). */
export const prefillName = (term: string | null | undefined): string => normalizeName(term ?? '').slice(0, NAME_MAX);

export type RequestStatus = 'NEW' | 'PLANNED' | 'ADDED' | 'DECLINED';
export type ChipTone = 'neutral' | 'notice' | 'positive' | 'problem';

export const STATUS_CHIP: Record<RequestStatus, { label: string; tone: ChipTone; sub: string }> = {
  NEW: { label: 'New', tone: 'neutral', sub: 'We have your request.' },
  PLANNED: { label: 'Planned', tone: 'notice', sub: "Good news: we're planning to stock it." },
  ADDED: { label: 'Added', tone: 'positive', sub: "It's in the shop now." },
  DECLINED: { label: 'Not stocking', tone: 'problem', sub: "We can't stock this one for now." },
};

const isStatus = (s: unknown): s is RequestStatus => s === 'NEW' || s === 'PLANNED' || s === 'ADDED' || s === 'DECLINED';
/** An unknown status reads as New. */
export const statusChip = (s: unknown) => STATUS_CHIP[isStatus(s) ? s : 'NEW'];

export interface MyRequest {
  id: string;
  name: string;
  note: string | null;
  status: RequestStatus;
  /** Set once ADDED: the product to open. */
  productId: string | null;
  categoryName: string | null;
  createdAt: Date | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** GET /me/product-requests data: `{ requests: [...] }` (or the list itself), newest first. */
export function parseMyRequests(raw: unknown): MyRequest[] {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(d?.requests) ? d!.requests as unknown[] : Array.isArray(d?.product_requests) ? d!.product_requests as unknown[] : [];
  const out: MyRequest[] = [];
  for (const item of list) {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const id = r ? text(r.id) ?? (typeof r.id === 'number' ? String(r.id) : null) : null;
    const name = r ? text(r.name) : null;
    if (!r || !id || !name) continue;
    const at = typeof r.created_at === 'string' ? new Date(r.created_at) : null;
    const status: RequestStatus = isStatus(r.status) ? r.status : 'NEW';
    out.push({
      id, name, note: text(r.note), status,
      productId: status === 'ADDED' ? text(r.product_id) : null,
      categoryName: text(r.category_name),
      createdAt: at && !Number.isNaN(at.getTime()) ? at : null,
    });
  }
  return out.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/** What the sheet says when sending fails. */
export function requestErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "You've sent a lot of requests today. Please try again tomorrow.";
    if (e.status === 0 || e.status === 408) return e.message;
    if (e.status === 400 || e.status === 422) return e.message && e.message !== 'Request failed.' ? e.message : 'Check the product name and try again.';
    if (e.status >= 500) return 'Something went wrong on our side. Please try again.';
    return e.message || "We couldn't send your request. Please try again.";
  }
  return "We couldn't send your request. Please try again.";
}

export const ASK_COPY = {
  title: "Can't find it? Ask us",
  sub: "Tell us what you'd like and we'll try to stock it.",
  inline: "Can't find what you need?",
  inlineSub: 'Ask us and we will try to stock it.',
  cta: 'Ask us',
  nameLabel: 'Product name',
  namePlaceholder: 'e.g. Anchor Butter 200g',
  noteLabel: 'Anything else? (optional)',
  notePlaceholder: 'Brand, size or how often you buy it',
  categoryLabel: 'Category (optional)',
  send: 'Send request',
  thanksTitle: 'Thanks! Request sent',
  thanksSignedIn: "We'll let you know if we add it. Follow it in My requests.",
  thanksGuest: 'We read every request. Sign in next time to follow it.',
  done: 'Done',
  myRequests: 'My requests',
  rowSub: 'Tell us what to stock',
  myRowSub: 'Products you asked us to stock',
  empty: 'No requests yet',
  emptySub: "Missing something you buy? Ask us and we'll try to stock it.",
  viewProduct: 'View product',
} as const;
