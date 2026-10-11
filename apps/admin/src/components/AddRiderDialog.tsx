import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import {
  riderDocuments,
  type AddRiderResult,
  type RiderDocumentBlocking,
  type RiderDocumentSettings,
  type RiderDocumentType,
} from '../api/riderDocuments';
import type { VehicleType } from '../api/types';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import {
  MOBILE_HINT,
  VEHICLE_TYPES,
  blockingText,
  documentFileProblem,
  fileSize,
  isPdf,
  isSriLankanMobile,
  staffUploadError,
} from '../lib/riderDocuments';
import { newPayDraft, payDraftToInput, type PayDraft, type PayDraftErrors } from '../lib/riderPay';
import { colomboDateKey } from '../lib/schedule';
import { DatePicker } from './DatePicker';
import { FilePickButtons, PAGE_NAME, useLocalPreview } from './RiderDocumentUpload';
import { RiderDocumentsPanel } from './RiderDocuments';
import { RiderPayFields, useRiderPayDefaults } from './RiderPayFields';
import { Field, Spinner } from './ui';
import './riderDocuments.css';

/**
 * "Add rider" (owner, 2026-10-11: "Add a delivery rider and I upload the
 * things"; riders send their documents on WhatsApp). The admin fills the
 * rider's details and pay, attaches each document (Choose file, or Take
 * photo on a phone or tablet) and saves:
 *   1. POST /admin/riders (one number = one account: a customer's number is
 *      attached, a waiting or rejected request is taken over);
 *   2. each chosen page is uploaded, front first, the expiry with the front;
 *   3. when the server did not approve at once, approve with the stored pay.
 * A failed upload keeps the rider (retry from their documents); approval
 * refused for documents leaves them waiting under Rider requests.
 */

export const VEHICLE_NAME: Record<VehicleType, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
  BICYCLE: 'Bicycle',
};

const NAME_MIN = 2;
const NAME_MAX = 128;
const REG_MAX = 32;

/** "+94771234567" -> "077 123 4567" (also tidies what the admin typed). */
export function readableMobile(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d+]/g, '');
  const local = digits.startsWith('+94') ? `0${digits.slice(3)}` : digits.startsWith('94') ? `0${digits.slice(2)}` : digits.startsWith('7') ? `0${digits}` : digits;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : phone;
}

/** What happened, for the page's notice. */
export interface AddRiderOutcome {
  riderId: string;
  riderName: string;
  tone: 'success' | 'warn';
  message: string;
}

interface DocDraft {
  pages: (File | null)[];
  expiry: string;
}

type FormErrors = Partial<Record<'full_name' | 'phone' | 'vehicle_registration_number' | 'emergency_contact_phone' | 'form', string>>;

const emptyDraft = (): DocDraft => ({ pages: [null, null], expiry: '' });

function createError(err: unknown): { field?: keyof FormErrors; message: string } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'STAFF_CAN_DELIVER':
        return { field: 'phone', message: 'This number belongs to an Operations account. Turn on "Can deliver" for them under Staff instead.' };
      case 'PHONE_IN_USE':
        return { field: 'phone', message: 'This number belongs to a staff or admin account. Use the rider\'s own number.' };
      case 'ACCOUNT_DISABLED':
        return { field: 'phone', message: 'The account with this number is disabled. Enable it first, then add them as a rider.' };
      case 'ALREADY_APPROVED':
        return { field: 'phone', message: 'This number is already a rider.' };
      default:
        break;
    }
  }
  return { message: errorMessage(err, 'Could not add the rider.', ['full_name', 'phone', 'vehicle_registration_number', 'emergency_contact_phone']) };
}

/** One page slot of a document in the form: preview + Choose file / Take photo / Remove. */
function PageSlot({
  name,
  side,
  file,
  disabled,
  testId,
  onFile,
  onRemove,
}: {
  name: string;
  /** "Front" / "Back". */
  side: string;
  file: File | null;
  disabled?: boolean;
  testId: string;
  onFile(file: File): void;
  onRemove(): void;
}) {
  const preview = useLocalPreview(file);
  return (
    <div className="rd-page" role="group" aria-label={name}>
      <div className="rd-page__file">
        <span className="rd-page__thumb" aria-hidden="true">
          {preview ? <img src={preview} alt="" /> : file && isPdf(file.type) ? 'PDF' : null}
        </span>
        <span className="rd-page__info">
          <strong>{side}</strong>
          <span className="cell__secondary">{file ? `${file.name} · ${fileSize(file.size)}` : disabled ? 'Add the front first.' : 'No file'}</span>
        </span>
      </div>
      <div className="rd-page__actions">
        <FilePickButtons name={name} replace={Boolean(file)} disabled={disabled} testId={testId} onFile={onFile} />
        {file ? (
          <button type="button" className="button button--ghost button--sm" aria-label={`Remove file: ${name}`} onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AddRiderDialog({ onClose, onDone }: { onClose(): void; onDone(outcome: AddRiderOutcome): void }) {
  const vehicleLabelId = useId();
  const { defaults } = useRiderPayDefaults();
  const [settings, setSettings] = useState<RiderDocumentSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState<VehicleType>('MOTORCYCLE');
  const [registration, setRegistration] = useState('');
  const [emergency, setEmergency] = useState('');
  const [draft, setDraft] = useState<PayDraft>(() => newPayDraft(null));
  const [payTouched, setPayTouched] = useState(false);
  const [payErrors, setPayErrors] = useState<PayDraftErrors>({});
  const [docs, setDocs] = useState<Record<string, DocDraft>>({});
  const [docErrors, setDocErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState<string | null>(null);
  const today = colomboDateKey();

  useEffect(() => {
    let live = true;
    riderDocuments
      .getSettings()
      .then((s) => live && setSettings(s))
      .catch((err) => live && setSettingsError(errorMessage(err, 'Could not load the document list.')));
    return () => {
      live = false;
    };
  }, []);

  // The pay starts from the store default once it loads (until the admin changes it).
  useEffect(() => {
    if (defaults && !payTouched) setDraft(newPayDraft(defaults));
  }, [defaults, payTouched]);

  const types: RiderDocumentType[] = (settings?.documents ?? []).filter((d) => d.enabled);
  const needsDocs = settings?.require_documents_for_approval !== false;
  const bicycle = vehicle === 'BICYCLE';

  const docDraft = (key: string) => docs[key] ?? emptyDraft();
  const setDoc = (key: string, patch: Partial<DocDraft>) => {
    setDocs((all) => ({ ...all, [key]: { ...(all[key] ?? emptyDraft()), ...patch } }));
    setDocErrors((all) => {
      const { [key]: _gone, ...rest } = all;
      return rest;
    });
  };

  function pick(type: RiderDocumentType, page: number, file: File) {
    const problem = documentFileProblem(file);
    if (problem) {
      setDocErrors((all) => ({ ...all, [type.key]: problem }));
      return;
    }
    const pages = [...docDraft(type.key).pages];
    pages[page] = file;
    setDoc(type.key, { pages });
  }

  function removeFile(type: RiderDocumentType, page: number) {
    const pages = [...docDraft(type.key).pages];
    pages[page] = null;
    // The back cannot stay without the front.
    if (page === 0) pages[1] = null;
    setDoc(type.key, { pages });
  }

  function validate(): { form: FormErrors; docs: Record<string, string> } {
    const form: FormErrors = {};
    const name = fullName.trim();
    if (name.length < NAME_MIN) form.full_name = 'Enter their full name.';
    else if (name.length > NAME_MAX) form.full_name = `Use at most ${NAME_MAX} characters.`;
    if (!isSriLankanMobile(phone)) form.phone = MOBILE_HINT;
    if (!bicycle) {
      const reg = registration.trim();
      if (reg.length < 2) form.vehicle_registration_number = 'Enter the number plate.';
      else if (reg.length > REG_MAX) form.vehicle_registration_number = `Use at most ${REG_MAX} characters.`;
    }
    if (emergency.trim() && !isSriLankanMobile(emergency)) form.emergency_contact_phone = MOBILE_HINT;
    const docProblems: Record<string, string> = {};
    for (const type of types) {
      const d = docDraft(type.key);
      const [front, back] = d.pages;
      if (!front && !back) continue;
      if (!front) docProblems[type.key] = 'Add the front page too.';
      else if (type.needs_back && !back) docProblems[type.key] = 'Add the back page too (or remove the front).';
      else if (type.needs_expiry && !d.expiry) docProblems[type.key] = 'Enter the expiry date printed on it (or remove the file).';
      else if (type.needs_expiry && d.expiry < today) docProblems[type.key] = 'This date has passed - the document is expired.';
    }
    return { form, docs: docProblems };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step) return;
    const found = validate();
    const pay = payDraftToInput(draft);
    setErrors(found.form);
    setDocErrors(found.docs);
    setPayErrors('errors' in pay ? pay.errors : {});
    if (Object.keys(found.form).length || Object.keys(found.docs).length || 'errors' in pay) return;

    // 1. Create the rider.
    setStep('Adding the rider…');
    let created: AddRiderResult;
    try {
      created = await riderDocuments.addRider({
        full_name: fullName.trim(),
        phone: phone.trim(),
        vehicle_type: vehicle,
        vehicle_registration_number: bicycle ? null : registration.trim(),
        emergency_contact_phone: emergency.trim() || null,
        ...pay.input,
      });
    } catch (err) {
      const fields = fieldErrors(err);
      const known = createError(err);
      setErrors({
        ...(fields.full_name ? { full_name: fields.full_name } : {}),
        ...(fields.phone ? { phone: fields.phone } : {}),
        ...(fields.vehicle_registration_number ? { vehicle_registration_number: fields.vehicle_registration_number } : {}),
        ...(fields.emergency_contact_phone ? { emergency_contact_phone: fields.emergency_contact_phone } : {}),
        ...(known.field ? { [known.field]: known.message } : { form: known.message }),
      });
      setStep(null);
      return;
    }

    const rider = created.rider;
    const riderName = rider.full_name ?? fullName.trim();
    const signIn = readableMobile(rider.phone ?? phone);

    // 2. Upload each chosen page, front first; the expiry goes with the front.
    const failed: string[] = [];
    for (const type of types) {
      const d = docDraft(type.key);
      const [front, back] = d.pages;
      if (!front) continue;
      try {
        setStep(`Uploading ${type.label}…`);
        await riderDocuments.uploadPage(rider.id, type.key, 0, front, type.needs_expiry && d.expiry ? d.expiry : undefined);
        if (back && type.needs_back) await riderDocuments.uploadPage(rider.id, type.key, 1, back);
      } catch (err) {
        failed.push(`${type.label} (${staffUploadError(err, 'upload failed')})`);
      }
    }
    const fromNote =
      created.from === 'CUSTOMER'
        ? ' Their customer account stays: they still shop with the same number.'
        : created.from === 'APPLICATION'
          ? ' Their earlier rider request was taken over.'
          : '';

    if (failed.length) {
      const state = created.approved
        ? `They can sign in to the Blynk Rider app with ${signIn} now.`
        : 'They wait under Rider requests until their documents are in.';
      onDone({
        riderId: rider.id,
        riderName,
        tone: 'warn',
        message: `${riderName} was saved, but these documents did not upload: ${failed.join(', ')}. Open their documents to try again. ${state}${fromNote}`,
      });
      return;
    }

    // 3. Approve with the pay stored at creation, unless the server already did.
    if (!created.approved) {
      setStep('Approving…');
      try {
        await riderDocuments.approveStored(rider.id);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'DOCUMENTS_NOT_VERIFIED') {
          const blocking = (err.details as { blocking?: RiderDocumentBlocking[] } | undefined)?.blocking ?? created.documents_blocking;
          onDone({
            riderId: rider.id,
            riderName,
            tone: 'warn',
            message: `${riderName} was saved and waits under Rider requests for: ${blockingText(blocking) || 'the required documents'}. Upload them there (an Admin can also "Approve anyway").${fromNote}`,
          });
        } else {
          onDone({
            riderId: rider.id,
            riderName,
            tone: 'warn',
            message: `${riderName} was saved but could not be approved: ${errorMessage(err, 'try again')}. Approve them under Rider requests.${fromNote}`,
          });
        }
        return;
      }
    }

    onDone({
      riderId: rider.id,
      riderName,
      tone: 'success',
      message: `Rider added. They can sign in to the Blynk Rider app with ${signIn} now.${fromNote}`,
    });
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add rider">
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">Add rider</h2>
        <p className="modal__message">
          For riders who send their details and documents on WhatsApp. They sign in to the Blynk Rider app with this phone number.
        </p>
        <Field label="Full name" error={errors.full_name}>
          <input className="input" value={fullName} maxLength={NAME_MAX} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <div className="form__row">
          <Field label="Phone" hint="Their own mobile; they sign in with it." error={errors.phone}>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              placeholder="077 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Emergency contact phone" hint="Optional." error={errors.emergency_contact_phone}>
            <input
              className="input"
              type="tel"
              inputMode="tel"
              maxLength={20}
              value={emergency}
              onChange={(e) => setEmergency(e.target.value)}
            />
          </Field>
        </div>
        <div className="field">
          <span className="field__label" id={vehicleLabelId}>
            Vehicle
          </span>
          <div className="rd-choices" role="group" aria-labelledby={vehicleLabelId}>
            {VEHICLE_TYPES.map((v) => (
              <button
                key={v}
                type="button"
                className={`rd-choice${vehicle === v ? ' is-selected' : ''}`}
                aria-pressed={vehicle === v}
                onClick={() => setVehicle(v)}
              >
                {VEHICLE_NAME[v]}
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

        <RiderPayFields
          draft={draft}
          defaults={defaults}
          errors={payErrors}
          onChange={(next) => {
            setPayTouched(true);
            setDraft(next);
          }}
        />

        <h3 className="rd-section-title">Documents</h3>
        {settingsError ? (
          <p className="field__error">{settingsError} You can still add the rider and upload documents later.</p>
        ) : !settings ? (
          <Spinner label="Loading the document list" />
        ) : types.length === 0 ? (
          <p className="form__note">No documents are asked for (Settings, Rider documents).</p>
        ) : (
          <>
            <p className="form__note" data-testid="add-rider-docs-note">
              {needsDocs
                ? 'Documents you upload here count as verified. Without every Required one the rider is saved and waits under Rider requests.'
                : 'Documents are not needed for approval: the rider can sign in as soon as they are added. Upload what you have.'}
            </p>
            <div className="rd-add-docs">
              {types.map((type) => {
                const d = docDraft(type.key);
                const required = type.required_for.includes(vehicle);
                return (
                  <div key={type.key} className="rd-add-doc" role="group" aria-label={`Document: ${type.label}`}>
                    <div className="rd-add-doc__head">
                      <h4>{type.label}</h4>
                      {required ? <span className="rd-chip rd-chip--required">Required</span> : <span className="rd-chip rd-chip--soft">Optional</span>}
                    </div>
                    {(type.needs_back ? [0, 1] : [0]).map((page) => (
                      <PageSlot
                        key={page}
                        name={`${type.label}, ${PAGE_NAME[page].toLowerCase()}`}
                        side={PAGE_NAME[page]}
                        file={d.pages[page] ?? null}
                        disabled={page === 1 && !d.pages[0]}
                        testId={`add-${type.key}-${page}`}
                        onFile={(file) => pick(type, page, file)}
                        onRemove={() => removeFile(type, page)}
                      />
                    ))}
                    {type.needs_expiry ? (
                      <div className="field">
                        <span className="field__label">Expiry date (as printed on the document)</span>
                        <DatePicker
                          label={`Expiry date: ${type.label}`}
                          value={d.expiry}
                          today={today}
                          onChange={(expiry) => setDoc(type.key, { expiry })}
                        />
                      </div>
                    ) : null}
                    {docErrors[type.key] ? (
                      <p className="field__error" role="alert">
                        {docErrors[type.key]}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {errors.form ? (
          <p className="field__error" role="alert">
            {errors.form}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" disabled={Boolean(step)} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={Boolean(step)}>
            {step ?? 'Add rider'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The page's note after "Add rider": green when the rider can sign in, amber
 * with "Open documents" when something still needs doing (owner, 2026-10-11).
 */
export function AddRiderNotice({ outcome, onDismiss, onChanged }: { outcome: AddRiderOutcome; onDismiss(): void; onChanged?(): void }) {
  const [docsOpen, setDocsOpen] = useState(false);
  return (
    <>
      <div className={`rd-notice rd-warning${outcome.tone === 'warn' ? '' : ' rd-notice--ok'}`} role="status" data-testid="add-rider-notice">
        <p>{outcome.message}</p>
        <div className="rd-notice__actions">
          <button type="button" className="button button--ghost button--sm" onClick={() => setDocsOpen(true)}>
            Open documents
          </button>
          <button type="button" className="button button--ghost button--sm" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
      {docsOpen ? (
        <RiderDocumentsPanel riderId={outcome.riderId} riderName={outcome.riderName} onClose={() => setDocsOpen(false)} onChanged={onChanged} />
      ) : null}
    </>
  );
}
