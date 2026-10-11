import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { riderApplications, riderDocuments, riders as ridersApi } from '../api/resources';
import type {
  CreateRiderInput,
  RiderDocumentBlocking,
  RiderDocumentSettings,
  RiderDocumentType,
  VehicleType,
} from '../api/types';
import { errorMessage } from '../lib/errors';
import {
  VEHICLE_TYPES,
  blockingLine,
  documentErrorMessage,
  documentFileProblem,
  isSriLankanMobile,
  readableMobile,
  uploadErrorMessage,
} from '../lib/riderDocuments';
import { newPayDraft, payDraftToInput, type PayDraft, type PayDraftErrors } from '../lib/riderPay';
import { colomboDate } from '../lib/slots';
import { DatePicker } from './DatePicker';
import { RiderPayFields, useRiderPayDefaults } from './RiderPayFields';
import { FilePickButtons, PickedFile, SIDE_LABEL } from './RiderDocumentUpload';
import { Field, Spinner } from './ui';
import './rider-documents.css';

/**
 * Riders -> Add rider (owner, 2026-10-11: "Add a delivery rider and I upload
 * the things"). Staff type the rider's details, pick how they are paid and
 * attach the documents the rider sent (e.g. on WhatsApp). Saving:
 *   1. POST /admin/riders - approved at once when nothing blocks approval;
 *   2. each picked page is uploaded (front first, the expiry date with it);
 *   3. a rider still PENDING is approved with the pay stored at step 1.
 * The backend decides every rule. If approval is refused (documents not
 * verified) the rider waits under Rider requests; a failed upload keeps the
 * rider and names the document, to upload again from Documents.
 */

const NAME_MIN = 2;
const NAME_MAX = 128;
const REG_MAX = 32;
const PHONE_HINT = 'Enter a Sri Lankan mobile number, e.g. 077 123 4567.';

/** The 409 refusals of POST /admin/riders, in plain words (owner, 2026-10-11). */
export const ADD_RIDER_MESSAGES: Record<string, string> = {
  STAFF_CAN_DELIVER:
    'This number belongs to an Operations staff account. To let them deliver, turn on "Can deliver" for their account in Staff accounts.',
  PHONE_IN_USE: 'This number belongs to a staff or admin account, so it cannot be a rider. Use another number.',
  ACCOUNT_DISABLED: 'The account for this number is disabled, so it cannot be added as a rider.',
  ALREADY_APPROVED: 'This number is already a rider.',
};

type FieldKey = 'full_name' | 'phone' | 'vehicle_registration_number' | 'emergency_contact_phone';
type FieldErrors = Partial<Record<FieldKey, string>>;

interface PickedDoc {
  front?: File;
  back?: File;
  expiry: string | null;
}

export interface AddRiderOutcome {
  message: string;
  /** true = the rider waits under Rider requests. */
  pending: boolean;
}

export function AddRiderSheet({ onClose, onDone }: { onClose(): void; onDone(outcome: AddRiderOutcome): void }) {
  const today = colomboDate(new Date());
  const [settings, setSettings] = useState<RiderDocumentSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState<VehicleType>('MOTORCYCLE');
  const [registration, setRegistration] = useState('');
  const [emergency, setEmergency] = useState('');
  const { defaults: payDefaults } = useRiderPayDefaults();
  const [payDraft, setPayDraft] = useState<PayDraft>(() => newPayDraft(null));
  const [payErrors, setPayErrors] = useState<PayDraftErrors>({});
  const [picked, setPicked] = useState<Record<string, PickedDoc>>({});
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    riderDocuments.settings
      .get()
      .then((s) => live && setSettings(s))
      .catch((err) => live && setSettingsError(documentErrorMessage(err, 'Could not load the rider documents list.')));
    return () => {
      live = false;
    };
  }, []);

  const docTypes: RiderDocumentType[] = (settings?.documents ?? []).filter((d) => d.enabled);
  const needDocs = settings?.require_documents_for_approval ?? true;
  const bicycle = vehicle === 'BICYCLE';

  function pickDoc(key: string, patch: Partial<PickedDoc>) {
    setPicked((all) => ({ ...all, [key]: { ...(all[key] ?? { expiry: null }), ...patch } }));
    setDocErrors((all) => {
      const next = { ...all };
      delete next[key];
      return next;
    });
  }

  function choose(d: RiderDocumentType, page: 0 | 1, file: File) {
    const problem = documentFileProblem(file);
    if (problem) {
      setDocErrors((all) => ({ ...all, [d.key]: problem }));
      return;
    }
    pickDoc(d.key, page === 0 ? { front: file } : { back: file });
  }

  function validate(): { fields: FieldErrors; docs: Record<string, string> } {
    const fields: FieldErrors = {};
    const name = fullName.trim();
    if (name.length < NAME_MIN || name.length > NAME_MAX) fields.full_name = `Enter their full name (${NAME_MIN} to ${NAME_MAX} characters).`;
    if (!isSriLankanMobile(phone)) fields.phone = PHONE_HINT;
    if (!bicycle) {
      const reg = registration.trim();
      if (reg.length < 2) fields.vehicle_registration_number = 'Enter the number plate.';
      else if (reg.length > REG_MAX) fields.vehicle_registration_number = `Use at most ${REG_MAX} characters.`;
    }
    if (emergency.trim() && !isSriLankanMobile(emergency)) {
      fields.emergency_contact_phone = 'Enter a Sri Lankan mobile number, or leave it empty.';
    }
    const docs: Record<string, string> = {};
    for (const d of docTypes) {
      const p = picked[d.key];
      if (p?.back && !p.front) docs[d.key] = 'Add the front page first.';
    }
    return { fields, docs };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const { fields, docs } = validate();
    const pay = payDraftToInput(payDraft);
    setErrors(fields);
    setDocErrors(docs);
    setPayErrors('errors' in pay ? pay.errors : {});
    if (Object.keys(fields).length > 0 || Object.keys(docs).length > 0 || 'errors' in pay) {
      setFormError('Check the highlighted fields.');
      return;
    }

    const body: CreateRiderInput = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      vehicle_type: vehicle,
      ...(bicycle ? {} : { vehicle_registration_number: registration.trim() }),
      emergency_contact_phone: emergency.trim() || null,
      ...pay.input,
    };

    setSaving(true);
    setProgress('Saving the rider…');
    let created;
    try {
      created = await ridersApi.create(body);
    } catch (err) {
      setSaving(false);
      setProgress(null);
      const code = err instanceof ApiError ? err.code : undefined;
      if (code && ADD_RIDER_MESSAGES[code]) {
        setErrors({ phone: ADD_RIDER_MESSAGES[code] });
        setFormError(ADD_RIDER_MESSAGES[code]);
      } else if (err instanceof ApiError && code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
        const next: FieldErrors = {};
        let other: string | null = null;
        for (const d of err.details as Array<{ field?: string; message?: string }>) {
          const field = d.field as FieldKey | undefined;
          if (field && ['full_name', 'phone', 'vehicle_registration_number', 'emergency_contact_phone'].includes(field)) {
            next[field] ??= d.message ?? 'Check this field.';
          } else other ??= d.message ?? null;
        }
        setErrors(next);
        setFormError(other ?? 'Check the highlighted fields.');
      } else {
        setFormError(errorMessage(err, 'Could not add the rider.'));
      }
      return;
    }

    // The rider exists now: from here on nothing undoes it (owner, 2026-10-11).
    const riderId = created.rider.id;
    const failed: string[] = [];
    for (const d of docTypes) {
      const p = picked[d.key];
      if (!p?.front) continue;
      const pages: Array<[0 | 1, File]> = [[0, p.front]];
      if (p.back) pages.push([1, p.back]);
      for (const [page, file] of pages) {
        setProgress(`Uploading ${d.label} (${SIDE_LABEL[page]})…`);
        try {
          const expiry = page === 0 && d.needs_expiry && p.expiry ? p.expiry : undefined;
          await riderDocuments.uploadPage(riderId, d.key, page, file, expiry);
        } catch (err) {
          failed.push(`${d.label} ${SIDE_LABEL[page]} (${uploadErrorMessage(err, 'upload failed')})`);
          break; // A back page cannot go up without its front.
        }
      }
    }

    let approved = created.approved;
    let blocking: RiderDocumentBlocking[] | null = null;
    let approveError: string | null = null;
    if (!approved) {
      setProgress('Approving…');
      try {
        await riderApplications.approveAsAdded(riderId);
        approved = true;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DOCUMENTS_NOT_VERIFIED') {
          blocking = (err.details as { blocking?: RiderDocumentBlocking[] } | null)?.blocking ?? [];
        } else approveError = documentErrorMessage(err, 'Could not approve the rider.');
      }
    }

    const name = created.rider.full_name ?? fullName.trim();
    const parts: string[] = [];
    if (approved) {
      parts.push(`Rider added. They can sign in to the Blynk Rider app with ${readableMobile(created.rider.phone ?? phone.trim())} now.`);
    } else if (blocking) {
      parts.push(
        blockingLine(blocking, `${name} was saved and waits under Rider requests for these documents`) ??
          `${name} was saved and waits under Rider requests until the required documents are verified.`
      );
    } else {
      parts.push(`${name} was saved but is not approved yet: ${approveError} Approve them under Rider requests.`);
    }
    if (created.from === 'CUSTOMER') parts.push('Their Blynk customer account stays the same.');
    if (failed.length > 0) {
      parts.push(
        `These documents did not upload: ${failed.join('; ')}. Upload them again from Documents${approved ? '' : ' under Rider requests'}.`
      );
    }
    setSaving(false);
    setProgress(null);
    onDone({ message: parts.join(' '), pending: !approved });
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add rider">
      <form className="modal__panel modal__panel--wide rdoc-add-rider" onSubmit={(e) => void submit(e)} noValidate>
        <div className="rdoc-sheet__head">
          <h2 className="modal__title">Add rider</h2>
          <button type="button" className="rdoc-round" aria-label="Close add rider" disabled={saving} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="quiet">
          For riders who send their details and documents to Blynk (e.g. on WhatsApp). They sign in to the Blynk Rider app with
          this phone number.
        </p>

        <Field label="Full name" error={errors.full_name}>
          <input className="input" value={fullName} maxLength={NAME_MAX} autoComplete="off" onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Phone" hint="Their mobile number. A customer's number keeps its account." error={errors.phone}>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            placeholder="077 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        <div className="field">
          <span className="field__label" id="add-rider-vehicle">
            Vehicle
          </span>
          <div className="specialty-chips" role="group" aria-labelledby="add-rider-vehicle">
            {VEHICLE_TYPES.map((v) => (
              <button
                key={v.id}
                type="button"
                className={v.id === vehicle ? 'specialty-chip is-selected' : 'specialty-chip'}
                aria-pressed={v.id === vehicle}
                onClick={() => setVehicle(v.id)}
              >
                {v.text}
              </button>
            ))}
          </div>
        </div>
        {!bicycle ? (
          <Field label="Registration number" error={errors.vehicle_registration_number}>
            <input
              className="input"
              value={registration}
              maxLength={REG_MAX}
              placeholder="WP BCX-8842"
              onChange={(e) => setRegistration(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Emergency contact phone" hint="Optional." error={errors.emergency_contact_phone}>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
          />
        </Field>

        <RiderPayFields
          draft={payDraft}
          onChange={(next) => {
            setPayDraft(next);
            setPayErrors({});
          }}
          defaults={payDefaults}
          errors={payErrors}
        />

        <section className="rdoc-add-docs" aria-label="Documents">
          <h3 className="section-label">Documents</h3>
          {settingsError ? <p className="field__error-text">{settingsError}</p> : null}
          {!settings && !settingsError ? <Spinner label="Loading documents" /> : null}
          {settings ? (
            <p className="quiet">
              {needDocs
                ? 'Required documents must all be here (with the expiry date where asked) to approve the rider now; otherwise they wait under Rider requests. You can add documents later too.'
                : 'Documents are not needed for approval. Add what the rider sent; you can add more later.'}
            </p>
          ) : null}
          {settings && docTypes.length === 0 ? <p className="quiet">No documents are asked for.</p> : null}
          {docTypes.map((d) => {
            const required = d.required_for.includes(vehicle);
            const p = picked[d.key] ?? { expiry: null };
            const sides: Array<0 | 1> = d.needs_back ? [0, 1] : [0];
            return (
              <div key={d.key} className="rdoc-add-doc" role="group" aria-label={d.label}>
                <p className="rdoc-tile__label">
                  {d.label}
                  {required ? <span className="rdoc-required">Required</span> : null}
                </p>
                {sides.map((page) => {
                  const file = page === 0 ? p.front : p.back;
                  const sideLabel = `${d.label} ${SIDE_LABEL[page]}`;
                  return (
                    <div key={page} className="rdoc-add-doc__side">
                      {d.needs_back ? <span className="rdoc-upload__side">{page === 0 ? 'Front' : 'Back'}</span> : null}
                      {file ? (
                        <PickedFile
                          file={file}
                          label={sideLabel}
                          onRemove={() => pickDoc(d.key, page === 0 ? { front: undefined } : { back: undefined })}
                        />
                      ) : (
                        <FilePickButtons
                          label={sideLabel}
                          testId={`add-${d.key}-${page}`}
                          disabled={saving}
                          onPick={(f) => choose(d, page, f)}
                        />
                      )}
                    </div>
                  );
                })}
                {d.needs_expiry ? (
                  <DatePicker
                    label={`Expiry date: ${d.label}`}
                    value={p.expiry}
                    onChange={(next) => pickDoc(d.key, { expiry: next })}
                    today={today}
                    min={today}
                    hint="As printed on the document."
                  />
                ) : null}
                {docErrors[d.key] ? <p className="field__error-text">{docErrors[d.key]}</p> : null}
              </div>
            );
          })}
        </section>

        {progress ? (
          <p className="quiet" role="status">
            {progress}
          </p>
        ) : null}
        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--ink" disabled={saving}>
            {saving ? 'Saving…' : 'Add rider'}
          </button>
        </div>
      </form>
    </div>
  );
}
