import { apiRequest, fetchPrivateFile } from './client';
import type { RiderApplication, RiderPayInput, VehicleType } from './types';

/**
 * Rider documents (backend migration 039, owner 2026-10-10): a rider signs
 * up with their Vehicle book (CR), Revenue licence, Insurance certificate and
 * Driving licence (plus any custom documents the store adds); Admin and
 * Operations verify each one before approving the rider. Pages are private
 * files fetched with the staff token (fetchPrivateFile) - never a public URL.
 */

export type RiderDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
/** EXPIRING = within 30 days (Colombo date). */
export type ExpiryState = 'EXPIRED' | 'EXPIRING' | 'OK';
export type RejectReason = 'BLURRY' | 'EXPIRED' | 'NAME_MISMATCH' | 'WRONG_DOCUMENT' | 'OTHER';

export interface RiderDocumentPage {
  index: number;
  /** image/jpeg | image/png | image/webp | application/pdf */
  content_type: string;
  bytes: number;
  uploaded_at: string;
}

export interface StaffRiderDocument {
  id: string;
  rider_id: string | null;
  /** VEHICLE_BOOK | REVENUE_LICENCE | INSURANCE | DRIVING_LICENCE | CUSTOM_XXXXXXXX */
  doc_type: string;
  label: string;
  custom: boolean;
  /** 0 = front, 1 = back. */
  pages: RiderDocumentPage[];
  pages_needed: 1 | 2;
  /** 'YYYY-MM-DD' */
  expiry_date: string | null;
  expiry_state: ExpiryState | null;
  status: RiderDocumentStatus;
  reject_reason: RejectReason | null;
  reject_reason_label: string | null;
  reject_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  updated_at: string;
}

export interface RiderDocumentRequirement {
  key: string;
  label: string;
  /** Required for THIS rider's vehicle type. */
  required: boolean;
  needs_expiry: boolean;
  needs_back: boolean;
  document_id: string | null;
  status: RiderDocumentStatus | 'MISSING';
  expiry_state: ExpiryState | null;
}

export interface RiderDocumentBlocking {
  key: string;
  label: string;
  status: RiderDocumentStatus | 'MISSING';
  expiry_state: ExpiryState | null;
}

/** The document fields GET /admin/rider-applications adds to each application. */
export interface RiderApplicationDocuments {
  documents: StaffRiderDocument[];
  document_requirements: RiderDocumentRequirement[];
  documents_blocking: RiderDocumentBlocking[];
  /** true = every REQUIRED document is VERIFIED and not expired -> Approve allowed. */
  documents_verified: boolean;
  /**
   * false = Settings -> "Documents needed before approval" is off (owner,
   * 2026-10-11): nothing blocks Approve. Absent on an older API.
   */
  approval_needs_documents?: boolean;
}

/** An application as the list returns it; the document fields are absent on an older API. */
export type RiderApplicationWithDocuments = RiderApplication & Partial<RiderApplicationDocuments>;

/** GET /admin/riders/:riderId/documents */
export interface RiderDocumentsForRider {
  rider: { id: string; full_name: string | null; vehicle_type: string; approval_status: string };
  documents: StaffRiderDocument[];
  requirements: RiderDocumentRequirement[];
  blocking: RiderDocumentBlocking[];
  all_required_verified: boolean;
  /** false = documents are not needed for approval (owner, 2026-10-11). Absent on an older API. */
  approval_needs_documents?: boolean;
}

export interface RiderDocumentAlert {
  document_id: string;
  rider_id: string;
  full_name: string | null;
  phone: string | null;
  doc_type: string;
  label: string;
  is_insurance: boolean;
  status: RiderDocumentStatus;
  expiry_date: string | null;
  expiry_state: 'EXPIRED' | 'EXPIRING';
}

/** A document type in Settings -> Rider documents. */
export interface RiderDocumentType {
  key: string;
  label: string;
  builtin: boolean;
  enabled: boolean;
  required_for: VehicleType[];
  needs_expiry: boolean;
  needs_back: boolean;
}

export interface RiderDocumentSettings {
  documents: RiderDocumentType[];
  /**
   * (owner, 2026-10-11: "they will send docs on WhatsApp") On = applicants
   * photograph and upload each document in the Rider app; off = they send
   * their details only and WhatsApp the documents, which staff upload here.
   * Absent on an older API.
   */
  applicant_uploads_enabled?: boolean;
  /**
   * (owner, 2026-10-11) On = a rider is approved only once every required
   * document is verified and not expired; off = approve without documents.
   * Absent on an older API.
   */
  require_documents_for_approval?: boolean;
  updated_at: string | null;
}

/** The two switches of Settings -> Rider documents (owner, 2026-10-11); each optional in the PUT. */
export interface RiderDocumentSwitches {
  applicant_uploads_enabled?: boolean;
  require_documents_for_approval?: boolean;
}

/** PUT row: omit `key` for a NEW custom document (label 2-80 chars). */
export interface RiderDocumentTypeInput {
  key?: string;
  label?: string;
  enabled: boolean;
  required_for: VehicleType[];
  needs_expiry: boolean;
  needs_back: boolean;
}

/** POST /admin/riders - "Add rider" (owner, 2026-10-11): staff add a rider and upload the documents themselves. */
export type AddRiderInput = {
  full_name: string;
  /** Sri Lankan mobile in any common format; the server normalises it. */
  phone: string;
  vehicle_type: VehicleType;
  /** null for a bicycle. */
  vehicle_registration_number: string | null;
  emergency_contact_phone: string | null;
} & RiderPayInput;

export interface AddRiderResult {
  /** Same shape as the approve endpoint's `application`; `id` is riders.id. */
  rider: RiderApplication;
  /** true = approved at once (nothing blocks approval). */
  approved: boolean;
  documents_blocking: RiderDocumentBlocking[];
  /** NEW_NUMBER, an existing CUSTOMER's number, or a waiting/rejected APPLICATION taken over. */
  from: 'NEW_NUMBER' | 'CUSTOMER' | 'APPLICATION';
}

/** Approve body: the pay fields plus the ADMIN-only documents override (audited server-side). */
export type ApproveWithOverrideInput = RiderPayInput & { override_documents: true; override_reason: string };

export const riderDocuments = {
  forRider: (riderId: string) => apiRequest<RiderDocumentsForRider>(`/admin/riders/${riderId}/documents`),

  /** The raw page (0 front, 1 back) as a Blob; the caller makes and revokes the object URL. */
  page: (documentId: string, page: number, signal?: AbortSignal) =>
    fetchPrivateFile(`/admin/rider-documents/${documentId}/pages/${page}`, signal),

  /** `expiry_date` corrects / enters the expiry printed on the document. */
  verify: (documentId: string, expiryDate?: string | null) =>
    apiRequest<{ document: StaffRiderDocument }>(`/admin/rider-documents/${documentId}/verify`, {
      method: 'POST',
      body: expiryDate ? { expiry_date: expiryDate } : {},
    }).then((d) => d.document),

  /** `note` is required for OTHER (max 300). */
  reject: (documentId: string, reason: RejectReason, note?: string) =>
    apiRequest<{ document: StaffRiderDocument }>(`/admin/rider-documents/${documentId}/reject`, {
      method: 'POST',
      body: note ? { reason, note } : { reason },
    }).then((d) => d.document),

  /** Approved riders whose documents expired or expire within `days`. */
  alerts: (days = 30) =>
    apiRequest<{ warning_days: number; alerts: RiderDocumentAlert[] }>(`/admin/rider-documents/alerts?days=${days}`),

  getSettings: () =>
    apiRequest<{ settings: RiderDocumentSettings }>('/admin/settings/rider-documents').then((d) => d.settings),

  /**
   * The document list and/or the two switches (owner, 2026-10-11): `documents`
   * null = the stored list is kept; a switch left out is kept too.
   */
  setSettings: (documents: RiderDocumentTypeInput[] | null, switches: RiderDocumentSwitches = {}) =>
    apiRequest<{ settings: RiderDocumentSettings }>('/admin/settings/rider-documents', {
      method: 'PUT',
      body: { ...(documents ? { documents: documents.map((d) => ({ ...d })) } : {}), ...switches },
    }).then((d) => d.settings),

  /** "Add rider" (owner, 2026-10-11). Approved at once when nothing blocks approval, else PENDING. */
  addRider: (input: AddRiderInput) =>
    apiRequest<AddRiderResult>('/admin/riders', { method: 'POST', body: { ...input } }),

  /**
   * Staff upload one page (0 front, 1 back) of a rider's document (owner,
   * 2026-10-11). Multipart: the browser sets the boundary. `expiryDate`
   * '' clears it; undefined leaves it. A complete document becomes VERIFIED.
   */
  uploadPage: (riderId: string, docType: string, page: number, file: File, expiryDate?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (expiryDate !== undefined) form.append('expiry_date', expiryDate);
    return apiRequest<{ document: StaffRiderDocument }>(
      `/admin/riders/${riderId}/documents/${encodeURIComponent(docType)}/pages/${page}`,
      { method: 'PUT', body: form }
    ).then((d) => d.document);
  },

  /** null when the last page was removed (the document is gone). */
  removePage: (riderId: string, docType: string, page: number) =>
    apiRequest<{ document: StaffRiderDocument | null }>(
      `/admin/riders/${riderId}/documents/${encodeURIComponent(docType)}/pages/${page}`,
      { method: 'DELETE' }
    ).then((d) => d.document ?? null),

  /** Set or clear (null) the expiry date; VERIFIED when that completes the document. */
  setExpiry: (riderId: string, docType: string, expiryDate: string | null) =>
    apiRequest<{ document: StaffRiderDocument }>(`/admin/riders/${riderId}/documents/${encodeURIComponent(docType)}`, {
      method: 'PATCH',
      body: { expiry_date: expiryDate },
    }).then((d) => d.document),

  /** Approve with the pay stored when the rider was added (body {}). */
  approveStored: (applicationId: string) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${applicationId}/approve`, {
      method: 'POST',
      body: {},
    }).then((d) => d.application),

  /** "Approve anyway" with documents still unverified (ADMIN only; recorded in the audit log). */
  approveWithOverride: (applicationId: string, input: ApproveWithOverrideInput) =>
    apiRequest<{ application: RiderApplication }>(`/admin/rider-applications/${applicationId}/approve`, {
      method: 'POST',
      body: { ...input },
    }).then((d) => d.application),

  /** A PENDING/REJECTED request with its documents and files (the account stays). */
  deleteApplication: (applicationId: string) =>
    apiRequest<{ deleted: boolean; documents_removed: number }>(`/admin/rider-applications/${applicationId}`, {
      method: 'DELETE',
    }),
};
