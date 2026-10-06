import { errorMessage } from '../lib/apiErrors';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { staff as staffApi } from '../api/resources';
import type { CreatableRole, StaffAccount, StaffRole, VehicleType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';

/**
 * Staff accounts (backend migration 014). Admins create the sign-ins for
 * the two staff apps, and each account opens only its own app:
 *   Inventory  (PACKING_STAFF) -> the Blynk Inventory site;
 *   Operations (OPERATIONS)    -> the Blynk Operations app.
 * Admin accounts are listed for reference only; the API refuses any change
 * to them (and to the signed-in admin's own account).
 *
 * "Can deliver" (staff riders, 2026-10-01): an Operations or Admin account -
 * the store lead, early on - can also be a rider. Turning it on gives the
 * account a rider profile (a number plate is needed the first time), so the
 * store can assign it orders and it delivers from the Operations app's
 * Delivery tab; turning it off is refused while it holds an open delivery.
 * Admin rows get this one control too.
 *
 * Admin and Rider accounts (owner, 2026-10-01): an admin can also create
 * another Admin (Admin website) and Rider accounts (Rider app, email +
 * password). A Rider account is created with its rider profile - vehicle,
 * number plate, optional emergency contact - and is active at once; its
 * vehicle is edited here ("Edit rider"), and disabling it is refused while
 * it still holds an open delivery. The list can be filtered by role.
 */

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  BICYCLE: 'Bicycle',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
};

const canHaveRider = (account: StaffAccount) => account.role === 'OPERATIONS' || account.role === 'ADMIN';

export const ROLE_LABEL: Record<CreatableRole, string> = {
  PACKING_STAFF: 'Inventory',
  OPERATIONS: 'Operations',
  ADMIN: 'Admin',
  RIDER: 'Rider',
};

/** Where each role signs in - named in the "account created" message. */
export const APP_FOR_ROLE: Record<CreatableRole, string> = {
  ADMIN: 'the Blynk Admin website',
  OPERATIONS: 'the Blynk Ops app',
  PACKING_STAFF: 'the Blynk Inventory website',
  RIDER: 'the Blynk Rider app',
};

/** An admin may create all four (backend staff.service.ts permission matrix). */
const CREATE_ROLES: CreatableRole[] = ['PACKING_STAFF', 'OPERATIONS', 'RIDER', 'ADMIN'];

/** Only Inventory and Operations accounts move between roles. */
const canChangeRole = (account: StaffAccount) => account.role === 'PACKING_STAFF' || account.role === 'OPERATIONS';

const vehicleText = (rider: NonNullable<StaffAccount['rider']>) =>
  `${VEHICLE_LABEL[rider.vehicle_type as VehicleType] ?? rider.vehicle_type} · ${rider.vehicle_registration_number}`;

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Sri Lankan mobile, as the API's normaliser accepts it (070-078, not 073). */
const PHONE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Colombo',
});

const errorText = (err: unknown, fallback: string) => errorMessage(err, fallback);

function passwordError(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'password'; account: StaffAccount }
  | { kind: 'role'; account: StaffAccount }
  | { kind: 'toggle'; account: StaffAccount }
  | { kind: 'deliverOn'; account: StaffAccount }
  | { kind: 'deliverOff'; account: StaffAccount }
  | { kind: 'rider'; account: StaffAccount }
  | null;

export function Staff() {
  const toast = useToast();
  const [rows, setRows] = useState<StaffAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'ALL' | CreatableRole>('ALL');
  const filterId = useId();
  const visible = rows?.filter((r) => roleFilter === 'ALL' || r.role === roleFilter) ?? null;

  const load = useCallback(async () => {
    try {
      setRows(await staffApi.list());
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Could not load staff accounts.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function replaceRow(updated: StaffAccount) {
    setRows((current) => current?.map((r) => (r.id === updated.id ? updated : r)) ?? current);
  }

  async function toggleDisabled(account: StaffAccount) {
    setDialog(null);
    try {
      const updated = await staffApi.update(account.id, { disabled: !account.disabled });
      replaceRow(updated);
      toast.success(
        updated.disabled
          ? `${account.full_name ?? account.email} can no longer sign in.`
          : `${account.full_name ?? account.email} can sign in again.`
      );
    } catch (err) {
      toast.error(errorText(err, 'Could not change the account.'));
    }
  }

  const nameOf = (account: StaffAccount) => account.full_name ?? account.email ?? account.phone;

  async function setCanDeliver(account: StaffAccount, canDeliver: boolean) {
    setDialog(null);
    try {
      const rider = await staffApi.setRider(account.id, { can_deliver: canDeliver });
      replaceRow({ ...account, rider });
      toast.success(
        canDeliver
          ? `${nameOf(account)} can deliver. They find their orders in the Operations app's Delivery tab.`
          : `${nameOf(account)} no longer delivers.`
      );
    } catch (err) {
      toast.error(errorText(err, 'Could not change delivering for this account.'));
    }
  }

  function onDeliverToggle(account: StaffAccount) {
    if (account.rider?.is_active) setDialog({ kind: 'deliverOff', account });
    else if (account.rider) void setCanDeliver(account, true);
    else setDialog({ kind: 'deliverOn', account });
  }

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Sign-ins for Admin, Operations, Inventory and Rider accounts. Each account opens only its own app."
        actions={
          <button type="button" className="button" onClick={() => setDialog({ kind: 'create' })}>
            Create account
          </button>
        }
      />

      {notice ? (
        <div className="staff-notice" role="status">
          <p>{notice}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? <p className="field__error">{error}</p> : null}

      {rows && rows.length > 0 ? (
        <div className="staff-filter">
          <label className="field__label" htmlFor={filterId}>
            Show
          </label>
          <select
            id={filterId}
            className="input"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'ALL' | CreatableRole)}
          >
            <option value="ALL">All roles</option>
            {CREATE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {rows === null || visible === null ? (
        <Spinner label="Loading staff accounts" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState title="No staff accounts yet" message="Create one for each person who packs, delivers or runs operations." />
        )
      ) : visible.length === 0 ? (
        <EmptyState title={`No ${ROLE_LABEL[roleFilter as CreatableRole]} accounts`} message="Choose another role to see more." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Staff accounts">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Can deliver</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((account) => (
                <tr key={account.id}>
                  <td>
                    <span className="cell__primary">{account.full_name || '-'}</span>
                    <span className="cell__secondary"> Added {dateFormat.format(new Date(account.created_at))}</span>
                  </td>
                  <td className="cell__secondary">{account.email ?? '-'}</td>
                  <td className="cell__secondary">{account.phone}</td>
                  <td>{ROLE_LABEL[account.role]}</td>
                  <td>
                    {account.read_only ? (
                      <Badge tone="muted">Read-only</Badge>
                    ) : account.disabled ? (
                      <Badge tone="inactive">Disabled</Badge>
                    ) : (
                      <Badge tone="active">{account.has_password ? 'Active' : 'Active, no password'}</Badge>
                    )}
                  </td>
                  <td>
                    {canHaveRider(account) ? (
                      <label className="toggle deliver-toggle">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={account.rider?.is_active ?? false}
                          aria-label={`Can deliver: ${nameOf(account)}`}
                          onChange={() => onDeliverToggle(account)}
                        />
                        <span>
                          {account.rider?.is_active ? 'Yes' : 'No'}
                          {account.rider?.is_active ? <em>{vehicleText(account.rider)}</em> : null}
                        </span>
                      </label>
                    ) : account.role === 'RIDER' && account.rider ? (
                      <span className="cell__secondary">{vehicleText(account.rider)}</span>
                    ) : (
                      <span className="cell__secondary">-</span>
                    )}
                  </td>
                  <td>
                    {account.read_only ? null : (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => setDialog({ kind: 'password', account })}
                        >
                          Reset password
                        </button>
                        {canChangeRole(account) ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={() => setDialog({ kind: 'role', account })}
                          >
                            Change role
                          </button>
                        ) : null}
                        {account.role === 'RIDER' ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={() => setDialog({ kind: 'rider', account })}
                          >
                            Edit rider
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => setDialog({ kind: 'toggle', account })}
                        >
                          {account.disabled ? 'Enable' : 'Disable'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'create' ? (
        <CreateStaffDialog
          roles={CREATE_ROLES}
          onClose={() => setDialog(null)}
          onCreated={(account) => {
            setDialog(null);
            setRows((current) => [account, ...(current ?? [])]);
            setNotice(
              `Account created for ${account.full_name ?? account.email}. They sign in to ` +
                `${APP_FOR_ROLE[account.role]} with ${account.email} and the password you set.`
            );
          }}
        />
      ) : null}

      {dialog?.kind === 'password' ? (
        <ResetPasswordDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null);
            replaceRow(updated);
            toast.success(`New password set for ${updated.full_name ?? updated.email}.`);
          }}
        />
      ) : null}

      {dialog?.kind === 'role' ? (
        <ChangeRoleDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null);
            replaceRow(updated);
            toast.success(
              `${updated.full_name ?? updated.email} is now ${ROLE_LABEL[updated.role]} and signs in to ` +
                `${APP_FOR_ROLE[updated.role]}.`
            );
          }}
        />
      ) : null}

      {dialog?.kind === 'rider' ? (
        <RiderDetailsDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={(updated) => {
            setDialog(null);
            replaceRow(updated);
            toast.success(`Rider details saved for ${nameOf(updated)}.`);
          }}
        />
      ) : null}

      {dialog?.kind === 'deliverOn' ? (
        <CanDeliverDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onSaved={(rider) => {
            const account = dialog.account;
            setDialog(null);
            replaceRow({ ...account, rider });
            toast.success(`${nameOf(account)} can deliver. They find their orders in the Operations app's Delivery tab.`);
          }}
        />
      ) : null}

      {dialog?.kind === 'deliverOff' ? (
        <ConfirmDialog
          title="Stop delivering"
          message={`${nameOf(dialog.account)} will no longer be offered when assigning riders. Any delivery they still hold must be finished or reassigned first.`}
          confirmLabel="Stop delivering"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={() => void setCanDeliver(dialog.account, false)}
        />
      ) : null}

      {dialog?.kind === 'toggle' ? (
        <ConfirmDialog
          title={dialog.account.disabled ? 'Enable account' : 'Disable account'}
          message={
            dialog.account.disabled
              ? `${dialog.account.full_name ?? dialog.account.email} will be able to sign in again.`
              : `${dialog.account.full_name ?? dialog.account.email} will be signed out and cannot sign in until you enable the account again.`
          }
          confirmLabel={dialog.account.disabled ? 'Enable' : 'Disable'}
          destructive={!dialog.account.disabled}
          onCancel={() => setDialog(null)}
          onConfirm={() => void toggleDisabled(dialog.account)}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------ password input
function PasswordInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  error?: string;
}) {
  const id = useId();
  const hintId = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="password-input">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          value={value}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="password-input__toggle"
          aria-controls={id}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {error ? (
        <span id={hintId} className="field__error">
          {error}
        </span>
      ) : (
        <span id={hintId} className="field__hint">
          At least {PASSWORD_MIN} characters.
        </span>
      )}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: StaffRole; onChange(role: StaffRole): void }) {
  return (
    <Field label="Role" hint={`Signs in to ${APP_FOR_ROLE[value]} only.`}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as StaffRole)}>
        <option value="PACKING_STAFF">Inventory</option>
        <option value="OPERATIONS">Operations</option>
      </select>
    </Field>
  );
}

// ------------------------------------------------------------ rider fields
const EMERGENCY_PATTERN = /^\+?[0-9 ()-]*$/;

function registrationError(registration: string): string | undefined {
  const reg = registration.trim();
  if (reg.length < 2) return 'Enter the number plate.';
  if (reg.length > 32) return 'Use at most 32 characters.';
  return undefined;
}

function emergencyError(phone: string): string | undefined {
  const value = phone.trim();
  if (value.length > 20) return 'Use at most 20 characters.';
  if (!EMERGENCY_PATTERN.test(value)) return 'Use digits only.';
  return undefined;
}

type RiderErrors = Partial<Record<'vehicle_registration_number' | 'emergency_contact_phone', string>>;

/** Vehicle, number plate and emergency contact: a Rider account's riders row. */
function RiderFields({
  vehicleType,
  registration,
  emergencyPhone,
  errors,
  onVehicleType,
  onRegistration,
  onEmergencyPhone,
}: {
  vehicleType: VehicleType;
  registration: string;
  emergencyPhone: string;
  errors: RiderErrors;
  onVehicleType(v: VehicleType): void;
  onRegistration(v: string): void;
  onEmergencyPhone(v: string): void;
}) {
  return (
    <>
      <Field label="Vehicle">
        <select className="input" value={vehicleType} onChange={(e) => onVehicleType(e.target.value as VehicleType)}>
          {(Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => (
            <option key={v} value={v}>
              {VEHICLE_LABEL[v]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Registration number" error={errors.vehicle_registration_number}>
        <input
          className="input"
          value={registration}
          maxLength={32}
          placeholder="WP BCX-8842"
          onChange={(e) => onRegistration(e.target.value)}
        />
      </Field>
      <Field label="Emergency contact phone" hint="Optional." error={errors.emergency_contact_phone}>
        <input
          className="input"
          type="tel"
          inputMode="tel"
          maxLength={20}
          value={emergencyPhone}
          onChange={(e) => onEmergencyPhone(e.target.value)}
        />
      </Field>
    </>
  );
}

// ------------------------------------------------------------ create dialog
type CreateErrors = Partial<Record<'full_name' | 'email' | 'password' | 'phone' | 'form', string>> & RiderErrors;

function CreateStaffDialog({
  roles,
  onClose,
  onCreated,
}: {
  roles: CreatableRole[];
  onClose(): void;
  onCreated(account: StaffAccount): void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CreatableRole>(roles[0]);
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [registration, setRegistration] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [errors, setErrors] = useState<CreateErrors>({});
  const [saving, setSaving] = useState(false);

  function validate(): CreateErrors {
    const next: CreateErrors = {};
    if (!fullName.trim()) next.full_name = 'Enter their full name.';
    if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address.';
    const pw = passwordError(password);
    if (pw) next.password = pw;
    // users.phone is required for every Blynk account.
    if (!PHONE_PATTERN.test(phone.replace(/[\s\-()]/g, ''))) {
      next.phone = 'Enter a Sri Lankan mobile number, e.g. 077 123 4567.';
    }
    if (role === 'RIDER') {
      const reg = registrationError(registration);
      if (reg) next.vehicle_registration_number = reg;
      const emergency = emergencyError(emergencyPhone);
      if (emergency) next.emergency_contact_phone = emergency;
    }
    return next;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const account = await staffApi.create({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        phone: phone.trim(),
        ...(role === 'RIDER'
          ? {
              vehicle_type: vehicleType,
              vehicle_registration_number: registration.trim(),
              emergency_contact_phone: emergencyPhone.trim() || null,
            }
          : {}),
      });
      onCreated(account);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
        setErrors({ email: 'Another account already uses this email address.' });
      } else if (err instanceof ApiError && err.code === 'PHONE_TAKEN') {
        setErrors({ phone: 'Another account already uses this phone number.' });
      } else {
        setErrors({ form: errorText(err, 'Could not create the account.') });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Create account">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Create account</h2>
        <Field label="Full name" error={errors.full_name}>
          <input className="input" value={fullName} maxLength={128} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input
            className="input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role" hint={`Signs in to ${APP_FOR_ROLE[role]} only.`}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as CreatableRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>
        <PasswordInput label="Password" value={password} onChange={setPassword} error={errors.password} />
        <Field label="Phone" hint="Their mobile number. They can also sign in with an SMS code." error={errors.phone}>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            placeholder="077 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        {role === 'RIDER' ? (
          <RiderFields
            vehicleType={vehicleType}
            registration={registration}
            emergencyPhone={emergencyPhone}
            errors={errors}
            onVehicleType={setVehicleType}
            onRegistration={setRegistration}
            onEmergencyPhone={setEmergencyPhone}
          />
        ) : null}
        {errors.form ? <p className="field__error">{errors.form}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Creating account" /> : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ reset password
function ResetPasswordDialog({
  account,
  onClose,
  onSaved,
}: {
  account: StaffAccount;
  onClose(): void;
  onSaved(account: StaffAccount): void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = passwordError(password);
    setError(found);
    if (found) return;
    setSaving(true);
    setFormError(null);
    try {
      onSaved(await staffApi.update(account.id, { password }));
    } catch (err) {
      setFormError(errorText(err, 'Could not set the password.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Reset password">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Reset password</h2>
        <p className="modal__message">
          Set a new password for {account.full_name ?? account.email}. This also lifts any sign-in lock and signs
          them out everywhere.
        </p>
        <PasswordInput label="New password" value={password} onChange={setPassword} error={error} />
        {formError ? <p className="field__error">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Set password'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ edit rider
/** A Rider account's vehicle, number plate and emergency contact. */
function RiderDetailsDialog({
  account,
  onClose,
  onSaved,
}: {
  account: StaffAccount;
  onClose(): void;
  onSaved(account: StaffAccount): void;
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    (account.rider?.vehicle_type as VehicleType | undefined) ?? 'MOTORCYCLE'
  );
  const [registration, setRegistration] = useState(account.rider?.vehicle_registration_number ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(account.rider?.emergency_contact_phone ?? '');
  const [errors, setErrors] = useState<RiderErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: RiderErrors = {};
    const reg = registrationError(registration);
    if (reg) found.vehicle_registration_number = reg;
    const emergency = emergencyError(emergencyPhone);
    if (emergency) found.emergency_contact_phone = emergency;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setFormError(null);
    try {
      onSaved(
        await staffApi.update(account.id, {
          vehicle_type: vehicleType,
          vehicle_registration_number: registration.trim(),
          emergency_contact_phone: emergencyPhone.trim() || null,
        })
      );
    } catch (err) {
      setFormError(errorText(err, 'Could not save the rider details.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Edit rider">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Edit rider</h2>
        <p className="modal__message">{account.full_name ?? account.email}'s vehicle, as the store sees it when assigning.</p>
        <RiderFields
          vehicleType={vehicleType}
          registration={registration}
          emergencyPhone={emergencyPhone}
          errors={errors}
          onVehicleType={setVehicleType}
          onRegistration={setRegistration}
          onEmergencyPhone={setEmergencyPhone}
        />
        {formError ? <p className="field__error">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save rider'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ can deliver
/** First time on: the rider profile needs the vehicle and its number plate. */
function CanDeliverDialog({
  account,
  onClose,
  onSaved,
}: {
  account: StaffAccount;
  onClose(): void;
  onSaved(rider: StaffAccount['rider']): void;
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [registration, setRegistration] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const reg = registration.trim();
    const found = reg.length < 2 ? 'Enter the number plate.' : reg.length > 32 ? 'Use at most 32 characters.' : undefined;
    setError(found);
    if (found) return;
    setSaving(true);
    setFormError(null);
    try {
      onSaved(
        await staffApi.setRider(account.id, {
          can_deliver: true,
          vehicle_type: vehicleType,
          vehicle_registration_number: reg,
        })
      );
    } catch (err) {
      setFormError(errorText(err, 'Could not let this account deliver.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Let this account deliver">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Let {account.full_name ?? account.email} deliver</h2>
        <p className="modal__message">
          They will be offered when assigning riders, and deliver from the Operations app's Delivery tab.
        </p>
        <Field label="Vehicle">
          <select className="input" value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleType)}>
            {(Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => (
              <option key={v} value={v}>
                {VEHICLE_LABEL[v]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Registration number" error={error}>
          <input
            className="input"
            value={registration}
            maxLength={32}
            placeholder="WP BCX-8842"
            onChange={(e) => setRegistration(e.target.value)}
          />
        </Field>
        {formError ? <p className="field__error">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Let deliver'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ change role
function ChangeRoleDialog({
  account,
  onClose,
  onSaved,
}: {
  account: StaffAccount;
  onClose(): void;
  onSaved(account: StaffAccount): void;
}) {
  const [role, setRole] = useState<StaffRole>(account.role === 'OPERATIONS' ? 'OPERATIONS' : 'PACKING_STAFF');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (role === account.role) {
      onClose();
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      onSaved(await staffApi.update(account.id, { role }));
    } catch (err) {
      setFormError(errorText(err, 'Could not change the role.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change role">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Change role</h2>
        <p className="modal__message">
          {account.full_name ?? account.email} will be signed out and must sign in again in their new app.
        </p>
        <RoleSelect value={role} onChange={setRole} />
        {formError ? <p className="field__error">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save role'}
          </button>
        </div>
      </form>
    </div>
  );
}
