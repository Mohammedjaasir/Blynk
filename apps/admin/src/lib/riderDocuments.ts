import { ApiError } from '../api/client';
import { errorMessage } from './apiErrors';
import type {
  ExpiryState,
  RejectReason,
  RiderDocumentAlert,
  RiderDocumentBlocking,
  RiderDocumentRequirement,
  RiderDocumentStatus,
  StaffRiderDocument,
} from '../api/riderDocuments';
import type { VehicleType } from '../api/types';

/**
 * Rider documents (owner, 2026-10-10): labels, the review strip's items,
 * expiry chips and the verify/reject error wording, shared by Rider requests,
 * the approved-rider Documents panel and Staff.
 */

export const DOC_STATUS_LABEL: Record<RiderDocumentStatus | 'MISSING', string> = {
  PENDING: 'Waiting review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  MISSING: 'Missing',
};

export const REJECT_REASONS: { reason: RejectReason; label: string }[] = [
  { reason: 'BLURRY', label: 'Blurry' },
  { reason: 'EXPIRED', label: 'Expired' },
  { reason: 'NAME_MISMATCH', label: 'Name mismatch' },
  { reason: 'WRONG_DOCUMENT', label: 'Wrong document' },
  { reason: 'OTHER', label: 'Other' },
];

export const REJECT_NOTE_MAX = 300;

export const VEHICLE_TYPES: VehicleType[] = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR', 'BICYCLE'];
/** "Required" on = required for every motor vehicle; bicycles stay off unless picked. */
export const MOTOR_VEHICLES: VehicleType[] = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'];

/** One tile in the review strip: a requirement and/or the uploaded document. */
export interface DocItem {
  key: string;
  label: string;
  required: boolean;
  needsExpiry: boolean;
  needsBack: boolean;
  status: RiderDocumentStatus | 'MISSING';
  doc: StaffRiderDocument | null;
}

/**
 * Requirements first (in the store's settings order), then any uploaded
 * document whose type is no longer listed (e.g. switched off) so staff can
 * still see it.
 */
export function documentItems(
  documents: StaffRiderDocument[] = [],
  requirements: RiderDocumentRequirement[] = []
): DocItem[] {
  const byType = new Map(documents.map((d) => [d.doc_type, d]));
  const items: DocItem[] = requirements.map((r) => {
    const doc = (r.document_id ? documents.find((d) => d.id === r.document_id) : undefined) ?? byType.get(r.key) ?? null;
    return {
      key: r.key,
      label: r.label,
      required: r.required,
      needsExpiry: r.needs_expiry,
      needsBack: r.needs_back,
      status: doc ? doc.status : r.status,
      doc,
    };
  });
  for (const doc of documents) {
    if (items.some((i) => i.doc?.id === doc.id || i.key === doc.doc_type)) continue;
    items.push({
      key: doc.doc_type,
      label: doc.label,
      required: false,
      needsExpiry: Boolean(doc.expiry_date),
      needsBack: doc.pages_needed === 2,
      status: doc.status,
      doc,
    });
  }
  return items;
}

/** "31 Mar 2027" for a 'YYYY-MM-DD' calendar day (no timezone shift). */
export function formatDay(key: string | null | undefined): string {
  if (!key) return '—';
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function expiryChip(state: ExpiryState | null | undefined): { tone: 'danger' | 'warn'; label: string } | null {
  if (state === 'EXPIRED') return { tone: 'danger', label: 'Expired' };
  if (state === 'EXPIRING') return { tone: 'warn', label: 'Expires soon' };
  return null;
}

export function statusTone(status: RiderDocumentStatus | 'MISSING'): 'ok' | 'wait' | 'danger' | 'missing' {
  if (status === 'VERIFIED') return 'ok';
  if (status === 'REJECTED') return 'danger';
  if (status === 'MISSING') return 'missing';
  return 'wait';
}

/** "Insurance certificate (missing), Driving licence (waiting review)". */
export function blockingText(blocking: RiderDocumentBlocking[] = []): string {
  return blocking
    .map((b) => {
      const why = b.expiry_state === 'EXPIRED' ? 'expired' : DOC_STATUS_LABEL[b.status].toLowerCase();
      return `${b.label} (${why})`;
    })
    .join(', ');
}

/** The badge an approved rider gets from GET /admin/rider-documents/alerts. */
export function alertBadge(alerts: RiderDocumentAlert[] = []): { tone: 'danger' | 'warn' | 'soft'; label: string } | null {
  const insurance = alerts.filter((a) => a.is_insurance);
  if (insurance.some((a) => a.expiry_state === 'EXPIRED')) return { tone: 'danger', label: 'Insurance expired' };
  if (insurance.some((a) => a.expiry_state === 'EXPIRING')) return { tone: 'warn', label: 'Insurance expiring soon' };
  if (alerts.some((a) => a.expiry_state === 'EXPIRED')) return { tone: 'soft', label: 'Documents expired' };
  if (alerts.length > 0) return { tone: 'soft', label: 'Documents expiring' };
  return null;
}

/** Verify / reject refusals in the reviewer's words. */
export function documentActionError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'EXPIRY_REQUIRED') return 'Enter the expiry date printed on the document, then verify.';
    if (err.code === 'DOCUMENT_EXPIRED') {
      return 'This document has expired, so it cannot be verified. Reject it as "Expired" so the rider uploads a current one.';
    }
    if (err.code === 'DOCUMENT_INCOMPLETE') {
      return 'The back of this document is missing. Reject it and ask the rider for a photo of both sides.';
    }
  }
  return errorMessage(err, fallback);
}

export const isPdf = (contentType: string | undefined) => contentType === 'application/pdf';
