import { ApiError, REQUEST_TIMEOUT_MS } from './client';
import type { VehicleType } from './types';

/**
 * Rider documents - the applicant's side (backend migration 039; owner,
 * 2026-10-10): "rider sign-up needs these documents" - Vehicle book (CR),
 * Revenue licence, Insurance certificate, Driving licence - "and Ops and
 * Admin verify them before approval".
 *
 * An applicant is not signed in (only approved riders are). They prove their
 * phone once with an SMS code (POST /riders/applications/session) and get an
 * APPLICANT token, good for 2 hours and accepted only by these endpoints. It
 * is kept apart from the rider session (its own storage key, in
 * sessionStorage so a camera hand-off that reloads the app does not lose it,
 * but gone when the app is closed).
 *
 * The document pages are private: they are fetched with the token as Blobs,
 * shown through object URLs and never cached.
 */

const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

const TOKEN_KEY = 'blynk.rider.applicantToken';
/** A document page upload may take a while on a weak connection. */
export const UPLOAD_TIMEOUT_MS = 90_000;
/** The API refuses pages over 8 MB (413 FILE_TOO_LARGE). */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export type RiderDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type ExpiryState = 'EXPIRED' | 'EXPIRING' | 'OK';

export interface RiderDocumentType {
  key: string;
  label: string;
  builtin: boolean;
  required_for: VehicleType[];
  needs_expiry: boolean;
  needs_back: boolean;
}

export interface RiderDocumentPage {
  index: number;
  content_type: string;
  bytes: number;
  uploaded_at: string;
}

export interface RiderDocument {
  id: string;
  doc_type: string;
  label: string;
  custom: boolean;
  pages: RiderDocumentPage[];
  pages_needed: 1 | 2;
  expiry_date: string | null;
  expiry_state: ExpiryState | null;
  status: RiderDocumentStatus;
  reject_reason: string | null;
  reject_reason_label: string | null;
  reject_note: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

export interface ApplicantApplication {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  vehicle_type: VehicleType;
  vehicle_registration_number: string | null;
  full_name: string | null;
  rejection_reason: string | null;
  applied_at: string | null;
}

export interface ApplicantState {
  phone: string;
  application: ApplicantApplication | null;
  document_types: RiderDocumentType[];
  documents: RiderDocument[];
}

export interface ApplicationDetails {
  full_name: string;
  vehicle_type: VehicleType;
  vehicle_registration_number?: string;
  emergency_contact_phone?: string;
}

export const applicantToken = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  save(token: string) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable: the session lasts as long as this screen */
    }
    memoryToken = token;
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignored */
    }
    memoryToken = null;
  },
};
let memoryToken: string | null = null;
const currentToken = () => applicantToken.get() ?? memoryToken;

function errorFrom(status: number, text: string): ApiError {
  let error: { message?: string; code?: string; details?: unknown } = {};
  try {
    error = (JSON.parse(text) as { error?: typeof error }).error ?? {};
  } catch {
    /* a non-JSON body */
  }
  return new ApiError(error.message ?? 'Request failed.', status, error.code, error.details);
}

async function withTimeout<T>(work: Promise<T>, ms: number, controller?: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new ApiError('The Blynk API did not answer in time.', 0, 'TIMEOUT'));
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false) {
    const token = currentToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  let response: Response;
  try {
    response = await withTimeout(
      fetch(`${BASE_URL}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      }),
      REQUEST_TIMEOUT_MS,
      controller
    );
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
  }
  const text = await response.text();
  if (!response.ok) throw errorFrom(response.status, text);
  const payload = text ? (JSON.parse(text) as { data?: T }) : {};
  return (payload.data ?? payload) as T;
}

const pagePath = (docType: string, page: number) =>
  `/riders/applications/documents/${encodeURIComponent(docType)}/pages/${page}`;

/**
 * One page upload with progress. XMLHttpRequest, because fetch cannot report
 * upload progress. On Android, CapacitorHttp sends it natively and may only
 * report the end - callers show an indeterminate bar until a real figure
 * arrives.
 */
function uploadWithProgress(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void
): Promise<{ document: RiderDocument }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${BASE_URL}${path}`);
    const token = currentToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
      };
    }
    xhr.onload = () => {
      const text = String(xhr.responseText ?? '');
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(text) as { data: { document: RiderDocument } };
          onProgress?.(1);
          resolve(payload.data);
        } catch {
          reject(new ApiError('The Blynk API sent an unreadable answer.', xhr.status, 'BAD_RESPONSE'));
        }
      } else {
        reject(errorFrom(xhr.status, text));
      }
    };
    xhr.onerror = () => reject(new ApiError('Could not reach the Blynk API.', 0, 'NETWORK'));
    xhr.ontimeout = () => reject(new ApiError('The upload took too long. Try again on a better connection.', 0, 'TIMEOUT'));
    xhr.send(form);
  });
}

export const applicantApi = {
  /** SMS code -> applicant token (stored) + the current state. */
  startSession: async (phone: string, otp: string) => {
    const data = await request<ApplicantState & { applicant_token: string; expires_in: number }>('/riders/applications/session', {
      method: 'POST',
      body: { phone, otp },
      auth: false,
    });
    applicantToken.save(data.applicant_token);
    return data;
  },
  state: () => request<ApplicantState>('/riders/applications/me'),
  uploadPage: async (
    docType: string,
    page: number,
    file: Blob,
    fileName: string,
    options: { expiryDate?: string | null; onProgress?: (fraction: number) => void } = {}
  ) => {
    const form = new FormData();
    if (options.expiryDate) form.append('expiry_date', options.expiryDate);
    form.append('file', file, fileName);
    return (await uploadWithProgress(pagePath(docType, page), form, options.onProgress)).document;
  },
  removePage: async (docType: string, page: number) =>
    (await request<{ document: RiderDocument | null }>(pagePath(docType, page), { method: 'DELETE' })).document,
  setExpiry: async (docType: string, expiryDate: string | null) =>
    (
      await request<{ document: RiderDocument }>(`/riders/applications/documents/${encodeURIComponent(docType)}`, {
        method: 'PATCH',
        body: { expiry_date: expiryDate },
      })
    ).document,
  /** A private page as a Blob (shown through an object URL, never cached). */
  fetchPage: async (docType: string, page: number): Promise<Blob> => {
    const token = currentToken();
    const controller = new AbortController();
    let response: Response;
    try {
      response = await withTimeout(
        fetch(`${BASE_URL}${pagePath(docType, page)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
          signal: controller.signal,
        }),
        REQUEST_TIMEOUT_MS,
        controller
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
    }
    if (!response.ok) throw errorFrom(response.status, await response.text());
    return response.blob();
  },
  submit: async (details: ApplicationDetails) =>
    request<{ application: { status: 'PENDING'; full_name: string; phone: string } }>('/riders/applications/submit', {
      method: 'POST',
      body: { ...details },
    }),
};

/** The documents this vehicle sees, each marked required or optional. */
export function documentsForVehicle(types: RiderDocumentType[], vehicle: VehicleType | null) {
  return types.map((t) => ({ ...t, required: vehicle ? t.required_for.includes(vehicle) : false }));
}

/** Uploaded enough pages (front, and back when asked) and not rejected. */
export function documentComplete(type: RiderDocumentType, doc: RiderDocument | undefined): boolean {
  if (!doc) return false;
  return doc.pages.length >= (type.needs_back ? 2 : 1) && doc.status !== 'REJECTED';
}
