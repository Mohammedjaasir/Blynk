import { ApiError } from '../api/client';
import type {
  RiderDocumentBlocking,
  RiderDocumentExpiryState,
  RiderDocumentRejectReason,
  RiderDocumentRequirement,
  RiderDocumentStatus,
  StaffRiderDocument,
  VehicleType,
} from '../api/types';
import { errorMessage } from './errors';
import type { Tone } from '../components/ui';

/**
 * Rider documents (owner, 2026-10-10): the words, tones and small rules the
 * Rider requests / Riders / Settings screens share. The backend decides
 * every rule (what is required, what blocks approval); this file only
 * explains its answers.
 */

export const VEHICLE_TYPES: ReadonlyArray<{ id: VehicleType; text: string }> = [
  { id: 'MOTORCYCLE', text: 'Motorcycle' },
  { id: 'SCOOTER', text: 'Scooter' },
  { id: 'THREE_WHEELER', text: 'Three-wheeler' },
  { id: 'CAR', text: 'Car' },
  { id: 'BICYCLE', text: 'Bicycle' },
];

/** "Required" on = every motor vehicle; a bicycle needs none of the built-ins. */
export const MOTOR_VEHICLES: VehicleType[] = ['MOTORCYCLE', 'SCOOTER', 'THREE_WHEELER', 'CAR'];

export const REJECT_REASONS: ReadonlyArray<{ id: RiderDocumentRejectReason; text: string }> = [
  { id: 'BLURRY', text: 'Blurry' },
  { id: 'EXPIRED', text: 'Expired' },
  { id: 'NAME_MISMATCH', text: 'Name mismatch' },
  { id: 'WRONG_DOCUMENT', text: 'Wrong document' },
  { id: 'OTHER', text: 'Other' },
];

export const REJECT_NOTE_MAX = 300;

export type DocumentState = RiderDocumentStatus | 'MISSING';

export const STATUS_LABEL: Record<DocumentState, string> = {
  PENDING: 'Waiting review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  MISSING: 'Missing',
};

export function statusTone(status: DocumentState, required = true): Tone {
  if (status === 'VERIFIED') return 'ok';
  if (status === 'REJECTED') return 'bad';
  if (status === 'MISSING') return required ? 'bad' : 'muted';
  return 'info';
}

export function expiryChip(state: RiderDocumentExpiryState | null): { tone: Tone; text: string } | null {
  if (state === 'EXPIRED') return { tone: 'bad', text: 'Expired' };
  if (state === 'EXPIRING') return { tone: 'warn', text: 'Expires soon' };
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2027-03-15' -> '15 Mar 2027'. */
export function formatDay(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** One tile per document type: requirements first (in their order), then any
 * uploaded document whose type is no longer listed (e.g. switched off). */
export interface DocumentSlot {
  key: string;
  label: string;
  required: boolean;
  needsExpiry: boolean;
  needsBack: boolean;
  document: StaffRiderDocument | null;
  state: DocumentState;
}

export function documentSlots(
  documents: StaffRiderDocument[] = [],
  requirements: RiderDocumentRequirement[] = []
): DocumentSlot[] {
  const used = new Set<string>();
  const slots: DocumentSlot[] = requirements.map((r) => {
    const document =
      documents.find((d) => d.id === r.document_id) ?? documents.find((d) => d.doc_type === r.key) ?? null;
    if (document) used.add(document.id);
    return {
      key: r.key,
      label: r.label,
      required: r.required,
      needsExpiry: r.needs_expiry,
      needsBack: r.needs_back,
      document,
      state: document && document.pages.length > 0 ? document.status : 'MISSING',
    };
  });
  for (const d of documents) {
    if (used.has(d.id)) continue;
    slots.push({
      key: d.doc_type,
      label: d.label,
      required: false,
      needsExpiry: Boolean(d.expiry_date),
      needsBack: d.pages_needed === 2,
      document: d,
      state: d.pages.length > 0 ? d.status : 'MISSING',
    });
  }
  return slots;
}

/** "Still needed: Insurance certificate (waiting review), Driving licence (missing)." */
export function blockingLine(blocking: RiderDocumentBlocking[] = [], prefix = 'Before approving, verify'): string | null {
  if (blocking.length === 0) return null;
  const parts = blocking.map((b) => {
    const why = b.expiry_state === 'EXPIRED' ? 'expired' : STATUS_LABEL[b.status].toLowerCase();
    return `${b.label} (${why})`;
  });
  return `${prefix}: ${parts.join(', ')}.`;
}

const DOCUMENT_MESSAGES: Record<string, string> = {
  EXPIRY_REQUIRED: 'This document needs its expiry date. Pick the date printed on it, then verify.',
  DOCUMENT_EXPIRED: 'This document has already expired, so it cannot be verified. Reject it as Expired so the rider uploads a new one.',
  DOCUMENT_INCOMPLETE: 'The back page is missing. The rider must upload both sides before it can be verified.',
  DOCUMENTS_NOT_VERIFIED: 'Some required documents are not verified yet.',
  OVERRIDE_ADMIN_ONLY: 'Only an Admin account can approve a rider without verified documents.',
  APPLICATION_APPROVED: 'This rider is already approved, so the request cannot be deleted.',
  DOCUMENT_PAGE_NOT_FOUND: 'This page was not uploaded.',
  DOCUMENT_FILE_MISSING: 'The file for this page is missing. Ask the rider to upload it again.',
};

export function documentErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'DOCUMENTS_NOT_VERIFIED') {
    const blocking = (err.details as { blocking?: RiderDocumentBlocking[] } | null)?.blocking;
    return blockingLine(blocking) ?? DOCUMENT_MESSAGES.DOCUMENTS_NOT_VERIFIED;
  }
  if (err instanceof ApiError && err.code && DOCUMENT_MESSAGES[err.code]) return DOCUMENT_MESSAGES[err.code];
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    const first = (err.details as Array<{ message?: string }>)[0];
    if (first?.message) return first.message;
  }
  return errorMessage(err, fallback);
}
