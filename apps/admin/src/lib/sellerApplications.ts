/*
 * Seller applications (owner's brother, 2026-10-27): shops apply on blynk.lk/seller; staff ring them
 * (the phone is a tap-to-call link), mark the application Contacted / Approved / Declined and, when
 * they agree, add them as a seller. The wording and the API are shared with Blynk Ops.
 */
export type SellerApplicationStatus = 'NEW' | 'CONTACTED' | 'APPROVED' | 'DECLINED';

export interface SellerApplication {
  id: string;
  shop_name: string;
  owner_name: string;
  /** +94XXXXXXXXX */
  phone: string;
  email: string | null;
  town: string;
  what_they_sell: string;
  message: string | null;
  status: SellerApplicationStatus;
  staff_note: string | null;
  handled_by_name?: string | null;
  handled_at?: string | null;
  source?: string;
  created_at: string;
}

export const APPLICATION_STATUSES: readonly SellerApplicationStatus[] = ['NEW', 'CONTACTED', 'APPROVED', 'DECLINED'];
export const APPLICATION_STATUS_LABEL: Record<SellerApplicationStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};
export const APPLICATION_STATUS_TONE: Record<SellerApplicationStatus, 'active' | 'inactive' | 'muted' | 'offer'> = {
  NEW: 'offer',
  CONTACTED: 'active',
  APPROVED: 'active',
  DECLINED: 'muted',
};
export const APPLICATION_NOTE_MAX = 500;

/** "All" and each status, with how many applications are in it. */
export function applicationCounts(rows: SellerApplication[]): Record<SellerApplicationStatus | 'ALL', number> {
  const out = { ALL: rows.length, NEW: 0, CONTACTED: 0, APPROVED: 0, DECLINED: 0 };
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** NEW first, then newest first (the server's order, kept after a local change). */
export function sortApplications(rows: SellerApplication[]): SellerApplication[] {
  const t = (r: SellerApplication) => Date.parse(r.created_at) || 0;
  return [...rows].sort((a, b) => Number(b.status === 'NEW') - Number(a.status === 'NEW') || t(b) - t(a));
}

/** "+94771234567" as staff dial and write it: "077 123 4567". Anything else is shown as it is. */
export function localPhone(phone: string): string {
  const m = /^\+94(\d{2})(\d{3})(\d{4})$/.exec(phone.trim());
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone;
}

/** The number for a tel: link. */
export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** What "Add as seller" hands to the Sellers page (router state), to fill the Add seller form. */
export interface AddSellerPrefill {
  application_id: string;
  shop_name: string;
  contact_name: string;
  phone: string;
}

export const addSellerState = (a: SellerApplication): { addSeller: AddSellerPrefill } => ({
  addSeller: { application_id: a.id, shop_name: a.shop_name, contact_name: a.owner_name, phone: localPhone(a.phone) },
});

/** The prefill out of a router state, or null when the page was not opened from an application. */
export function readAddSellerState(state: unknown): AddSellerPrefill | null {
  const s = (state as { addSeller?: Partial<AddSellerPrefill> } | null | undefined)?.addSeller;
  if (!s || typeof s.application_id !== 'string' || typeof s.shop_name !== 'string' || typeof s.phone !== 'string') return null;
  return {
    application_id: s.application_id,
    shop_name: s.shop_name,
    contact_name: typeof s.contact_name === 'string' ? s.contact_name : '',
    phone: s.phone,
  };
}
