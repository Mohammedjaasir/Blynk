import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { staff as staffApi } from '../api/resources';
import type { CreatableRole, StaffAccount, StaffRole, UserRole, VehicleType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';

/**
 * More -> Staff accounts (owner, 2026-10-01: "in the admin and operation add
 * the option to create a new credential for rider, admin, inventory"). A port
 * of the Admin site's Staff accounts page (apps/admin/src/pages/Staff.tsx - a
 * fresh copy, there is no shared package), laid out as cards for the phone.
 *
 * What it offers follows the backend's permission matrix
 * (backend staff.service.ts), which is the real guard:
 *   - an Operations user creates and manages only Inventory and Rider
 *     accounts (reset password, disable/enable, edit a rider's vehicle);
 *   - an Admin signed in here sees everything: all four roles to create,
 *     and Change role on Inventory/Operations accounts.
 * Accounts the caller may not change come back `read_only` and get no
 * actions. Like the rest of this app, results show in a local notice
 * rather than a toast.
 */

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  BICYCLE: 'Bicycle',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
};

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

/**
 * The roles each caller may create (mirrors the backend matrix). Riders are
 * not created here: they apply in the Rider app and are approved under
 * Rider requests (backend migration 029).
 */
export function creatableRoles(role: UserRole | undefined): CreatableRole[] {
  if (role === 'ADMIN') return ['PACKING_STAFF', 'OPERATIONS', 'ADMIN'];
  if (role === 'OPERATIONS') return ['PACKING_STAFF'];
  return [];
}

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Sri Lankan mobile, as the API's normaliser accepts it (070-078, not 073). */
const PHONE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;
const EMERGENCY_PATTERN = /^\+?[0-9 ()-]*$/;

const vehicleText = (rider: NonNullable<StaffAccount['rider']>) =>
  `${VEHICLE_LABEL[rider.vehicle_type as VehicleType] ?? rider.vehicle_type} · ${rider.vehicle_registration_number}`;
const nameOf = (account: StaffAccount) => account.full_name ?? account.email ?? account.phone ?? 'this account';
/**
 * Admin and Inventory accounts sign in with email and password only and have
 * no phone (backend migration 028); Rider and Operations accounts need one.
 */
export const roleNeedsPhone = (role: CreatableRole) => role === 'RIDER' || role === 'OPERATIONS';
/** A staff phone for display: "—" when the account has none. */
export const phoneText = (phone: string | null | undefined) => phone || '—';
const canChangeRole = (account: StaffAccount) => account.role === 'PACKING_STAFF' || account.role === 'OPERATIONS';

/** A 400 VALIDATION_ERROR whose details name the `phone` field. */
function isPhoneValidationError(err: ApiError): boolean {
  if (err.code !== 'VALIDATION_ERROR' || !Array.isArray(err.details)) return false;
  return err.details.some((d) => (d as { field?: unknown } | null)?.field === 'phone');
}

function passwordError(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

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

type Dialog =
  | { kind: 'create' }
  | { kind: 'password'; account: StaffAccount }
  | { kind: 'role'; account: StaffAccount }
  | { kind: 'toggle'; account: StaffAccount }
  | { kind: 'rider'; account: StaffAccount }
  | null;

export function StaffAccounts() {
  const { user } = useAuth();
  const roles = creatableRoles(user?.role);
  const isAdmin = user?.role === 'ADMIN';
  const [rows, setRows] = useState<StaffAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'ALL' | CreatableRole>('ALL');
  const filterId = useId();
  const visible = rows?.filter((r) => roleFilter === 'ALL' || r.role === roleFilter) ?? null;
  // Admins also see Operations and Admin rows; the filter offers what the list can hold.
  const filterRoles: CreatableRole[] = isAdmin ? ['PACKING_STAFF', 'RIDER', 'OPERATIONS', 'ADMIN'] : ['PACKING_STAFF', 'RIDER'];

  const load = useCallback(async () => {
    try {
      setRows(await staffApi.list());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load staff accounts.'));
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
    setError(null);
    try {
      const updated = await staffApi.update(account.id, { disabled: !account.disabled });
      replaceRow(updated);
      setNotice(updated.disabled ? `${nameOf(account)} can no longer sign in.` : `${nameOf(account)} can sign in again.`);
    } catch (err) {
      setNotice(null);
      setError(errorMessage(err, 'Could not change the account.'));
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Staff accounts"
        description={
          isAdmin
            ? 'Sign-ins for Admin, Operations, Inventory and Rider accounts. New riders apply in the Rider app; approve them under Rider requests.'
            : 'Sign-ins for Inventory and Rider accounts. New riders apply in the Rider app; approve them under Rider requests.'
        }
        actions={
          <button type="button" className="button button--sm" onClick={() => setDialog({ kind: 'create' })}>
            Create account
          </button>
        }
      />

      {notice ? (
        <div className="banner staff-notice" role="status">
          <p>{notice}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="field">
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
            {filterRoles.map((r) => (
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
        error ? null : <EmptyState title="No accounts yet" message="Create one for each person who packs or delivers." />
      ) : visible.length === 0 ? (
        <EmptyState title={`No ${ROLE_LABEL[roleFilter as CreatableRole]} accounts`} message="Choose another role to see more." />
      ) : (
        <ul className="cat-list" aria-label="Staff accounts">
          {visible.map((account) => (
            <li key={account.id} className="cat-row cat-row--flat">
              <div className="cat-row__main">
                <p className="cat-row__title">{account.full_name || '-'}</p>
                <p className="cat-row__meta">
                  {ROLE_LABEL[account.role]} · {account.email ?? 'no email'}
                </p>
                <p className="cat-row__meta mono">{phoneText(account.phone)}</p>
                {account.rider && (account.role === 'RIDER' || account.rider.is_active) ? (
                  <p className="cat-row__meta">{vehicleText(account.rider)}</p>
                ) : null}
                <p className="cat-row__meta">
                  {account.read_only ? (
                    <Badge tone="muted">Read-only</Badge>
                  ) : account.disabled ? (
                    <Badge tone="inactive">Disabled</Badge>
                  ) : (
                    <Badge tone="active">{account.has_password ? 'Active' : 'Active, no password'}</Badge>
                  )}
                </p>
                {account.read_only ? null : (
                  <div className="cat-row__actions">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setDialog({ kind: 'password', account })}
                    >
                      Reset password
                    </button>
                    {isAdmin && canChangeRole(account) ? (
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
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'create' ? (
        <CreateDialog
          roles={roles}
          onClose={() => setDialog(null)}
          onCreated={(account) => {
            setDialog(null);
            setError(null);
            setRows((current) => [account, ...(current ?? [])]);
            setNotice(
              `Account created for ${nameOf(account)}. They sign in to ${APP_FOR_ROLE[account.role]} ` +
                `with ${account.email} and the password you set.`
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
            setNotice(`New password set for ${nameOf(updated)}.`);
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
            setNotice(`${nameOf(updated)} is now ${ROLE_LABEL[updated.role]} and signs in to ${APP_FOR_ROLE[updated.role]}.`);
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
            setNotice(`Rider details saved for ${nameOf(updated)}.`);
          }}
        />
      ) : null}

      {dialog?.kind === 'toggle' ? (
        <ConfirmDialog
          title={dialog.account.disabled ? 'Enable account' : 'Disable account'}
          message={
            dialog.account.disabled
              ? `${nameOf(dialog.account)} will be able to sign in again.`
              : `${nameOf(dialog.account)} will be signed out and cannot sign in until the account is enabled again.`
          }
          confirmLabel={dialog.account.disabled ? 'Enable' : 'Disable'}
          destructive={!dialog.account.disabled}
          onCancel={() => setDialog(null)}
          onConfirm={() => void toggleDisabled(dialog.account)}
        />
      ) : null}
    </div>
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
        <span id={hintId} className="field__error-text">
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

// ------------------------------------------------------------ rider fields
type RiderErrors = Partial<Record<'vehicle_registration_number' | 'emergency_contact_phone', string>>;

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

function CreateDialog({
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
  const [role, setRole] = useState<CreatableRole>(roles[0] ?? 'PACKING_STAFF');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('MOTORCYCLE');
  const [registration, setRegistration] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [errors, setErrors] = useState<CreateErrors>({});
  const [saving, setSaving] = useState(false);
  const needsPhone = roleNeedsPhone(role);

  function validate(): CreateErrors {
    const next: CreateErrors = {};
    if (!fullName.trim()) next.full_name = 'Enter their full name.';
    if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address.';
    const pw = passwordError(password);
    if (pw) next.password = pw;
    if (needsPhone && !PHONE_PATTERN.test(phone.replace(/[\s\-()]/g, ''))) {
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
      onCreated(
        await staffApi.create({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
          // Inventory (and Admin) accounts have no phone: never send one.
          ...(needsPhone ? { phone: phone.trim() } : {}),
          ...(role === 'RIDER'
            ? {
                vehicle_type: vehicleType,
                vehicle_registration_number: registration.trim(),
                emergency_contact_phone: emergencyPhone.trim() || null,
              }
            : {}),
        })
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
        setErrors({ email: 'Another account already uses this email address.' });
      } else if (err instanceof ApiError && err.code === 'PHONE_TAKEN') {
        setErrors({ phone: 'Another account already uses this phone number.' });
      } else if (err instanceof ApiError && (err.code === 'PHONE_REQUIRED' || isPhoneValidationError(err))) {
        setErrors({ phone: 'Enter a Sri Lankan mobile number, e.g. 077 123 4567.' });
      } else {
        setErrors({ form: errorMessage(err, 'Could not create the account.') });
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
            autoCapitalize="none"
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
        {needsPhone ? (
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
        ) : (
          <p className="field__hint">No phone needed: they sign in with their email and password.</p>
        )}
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
      setFormError(errorMessage(err, 'Could not set the password.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Reset password">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Reset password</h2>
        <p className="modal__message">
          Set a new password for {nameOf(account)}. This also lifts any sign-in lock and signs them out everywhere.
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
      setFormError(errorMessage(err, 'Could not save the rider details.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Edit rider">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Edit rider</h2>
        <p className="modal__message">{nameOf(account)}'s vehicle, as the store sees it when assigning.</p>
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

// ------------------------------------------------------------ change role
/** Admin callers only: moves an account between Inventory and Operations. */
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
      setFormError(errorMessage(err, 'Could not change the role.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Change role">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Change role</h2>
        <p className="modal__message">{nameOf(account)} will be signed out and must sign in again in their new app.</p>
        <Field label="Role" hint={`Signs in to ${APP_FOR_ROLE[role]} only.`}>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="PACKING_STAFF">Inventory</option>
            <option value="OPERATIONS">Operations</option>
          </select>
        </Field>
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
