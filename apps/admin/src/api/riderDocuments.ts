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
  updated_at: string | null;
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

  setSettings: (documents: RiderDocumentTypeInput[]) =>
    apiRequest<{ settings: RiderDocumentSettings }>('/admin/settings/rider-documents', {
      method: 'PUT',
      body: { documents: documents.map((d) => ({ ...d })) },
    }).then((d) => d.settings),

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
