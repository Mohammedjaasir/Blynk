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
  // Staff uploads (owner, 2026-10-11).
  UNSUPPORTED_MEDIA_TYPE: 'Use a JPEG, PNG or WebP photo, or a PDF. iPhone HEIC photos cannot be used.',
  FILE_TOO_LARGE: 'This file is larger than 8 MB. Take the photo again or choose a smaller file.',
  DOCUMENT_PAGE_ORDER: 'Upload the front page first, then the back.',
  DOCUMENT_TYPE_NOT_FOUND: 'This document is no longer in Settings -> Rider documents.',
  RIDER_NOT_FOUND: 'This rider was not found. Refresh the list and try again.',
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


// ---------------------------------------------------------------------------
// Staff uploads (owner, 2026-10-11: "Mainly I am going to approve the drivers
// manually; they will send docs on WhatsApp" / "Add a delivery rider and I
// upload the things"). The backend re-checks every rule; these only answer
// early so a slow 8 MB upload is not wasted.
// ---------------------------------------------------------------------------

/** The API's limit for one page. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const DOCUMENT_FILE_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** A friendly reason the file cannot be used, or null when it is fine (owner, 2026-10-11). */
export function documentFileProblem(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = file.type || EXTENSION_TYPES[ext] || '';
  if (/hei[cf]/i.test(type) || ext === 'heic' || ext === 'heif') {
    return 'iPhone HEIC photos cannot be used. Take the photo again in JPEG, or send a screenshot.';
  }
  if (!DOCUMENT_TYPES.includes(type)) return 'Use a JPEG, PNG or WebP photo, or a PDF.';
  if (file.size > MAX_DOCUMENT_BYTES) return 'This file is larger than 8 MB. Take the photo again or choose a smaller file.';
  return null;
}

export const isPdfFile = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** Upload-time messages: an expired date here is the date staff picked. */
export function uploadErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'DOCUMENT_EXPIRED') {
    return 'That expiry date has already passed. Pick the date printed on a document that is still valid.';
  }
  return documentErrorMessage(err, fallback);
}

/** Sri Lankan mobile, as the API's normaliser accepts it (070-078, not 073). */
export const SL_MOBILE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;
export const isSriLankanMobile = (phone: string) => SL_MOBILE_PATTERN.test(phone.replace(/[\s\-()]/g, ''));

/** "+94771234567" -> "077 123 4567". */
export function readableMobile(phone: string | null | undefined): string {
  if (!phone) return '—';
  const local = phone.startsWith('+94') ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}
