import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { staff as staffApi } from '../api/resources';
import type { StaffAccount, StaffRole } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';

/**
 * Staff accounts (backend migration 014). Admins create the sign-ins for
 * the two staff apps, and each account opens only its own app:
 *   Inventory  (PACKING_STAFF) -> the Blynk Inventory site;
 *   Operations (OPERATIONS)    -> the Blynk Operations app.
 * Admin accounts are listed for reference only; the API refuses any change
 * to them (and to the signed-in admin's own account).
 */

export const ROLE_LABEL: Record<StaffAccount['role'], string> = {
  PACKING_STAFF: 'Inventory',
  OPERATIONS: 'Operations',
  ADMIN: 'Admin',
};

export const APP_FOR_ROLE: Record<StaffRole, string> = {
  PACKING_STAFF: 'the Blynk Inventory site',
  OPERATIONS: 'the Blynk Operations app',
};

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

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

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
  | null;

export function Staff() {
  const toast = useToast();
  const [rows, setRows] = useState<StaffAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  return (
    <>
      <PageHeader
        title="Staff accounts"
        description="Sign-ins for Inventory and Operations staff. Each account opens only its own app."
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

      {rows === null ? (
        <Spinner label="Loading staff accounts" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState title="No staff accounts yet" message="Create one for each person who packs or runs operations." />
        )
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
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => (
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
                    {account.read_only ? null : (
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => setDialog({ kind: 'password', account })}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => setDialog({ kind: 'role', account })}
                        >
                          Change role
                        </button>
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
          onClose={() => setDialog(null)}
          onCreated={(account) => {
            setDialog(null);
            setRows((current) => [account, ...(current ?? [])]);
            setNotice(
              `Account created for ${account.full_name ?? account.email}. They sign in to ` +
                `${APP_FOR_ROLE[account.role as StaffRole]} with ${account.email} and the password you set.`
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
                `${APP_FOR_ROLE[updated.role as StaffRole]}.`
            );
          }}
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

// ------------------------------------------------------------ create dialog
type CreateErrors = Partial<Record<'full_name' | 'email' | 'password' | 'phone' | 'form', string>>;

function CreateStaffDialog({ onClose, onCreated }: { onClose(): void; onCreated(account: StaffAccount): void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('PACKING_STAFF');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
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
        <RoleSelect value={role} onChange={setRole} />
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
