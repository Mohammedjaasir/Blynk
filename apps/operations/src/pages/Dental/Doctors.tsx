import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { dental } from '../../api/resources';
import { DENTAL_SPECIALTIES, DENTAL_SPECIALTY_LABEL, type DentalDoctor, type DentalSpecialty } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, EmptyState, Field, Spinner } from '../../components/ui';
import { dentalErrorMessage, formatRating } from '../../lib/dental';

/**
 * Dental doctors: create, edit and activate/deactivate (task F8, plan §16).
 * Ported from `apps/admin/src/pages/DentalDoctors.tsx` (a fresh
 * implementation, not an import - common.md rule 2), as a mobile card list.
 * No hard-delete endpoint (same reasoning as Clinics.tsx). Attaching a
 * doctor to a clinic (with a fee) happens from a clinic's detail screen.
 *
 * Specialty is a `<select>` populated from `DENTAL_SPECIALTIES`
 * (`src/api/types.ts`), the real backend enum copied from
 * `dental-admin.schema.ts` and re-confirmed against that file this session -
 * never a hardcoded/guessed list (task-F8-brief.md's explicit instruction).
 */
export function Doctors() {
  const [rows, setRows] = useState<DentalDoctor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<DentalDoctor | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await dental.doctors.list());
      setError(null);
    } catch (err) {
      setError(dentalErrorMessage(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(doctor: DentalDoctor) {
    try {
      await dental.doctors.update(doctor.id, { is_active: !doctor.is_active });
      setNotice(`${doctor.full_name} is now ${doctor.is_active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Dental doctors"
        description="Doctors bookable through the customer app, at whichever clinics attach them."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add doctor
          </button>
        }
      />

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading doctors" />
      ) : rows.length === 0 ? (
        <EmptyState title="No doctors yet" message="Add a doctor, then attach them to a clinic." />
      ) : (
        <ul className="cat-list">
          {rows.map((doctor) => (
            <li key={doctor.id} className={`cat-row cat-row--flat${!doctor.is_active ? ' is-muted' : ''}`}>
              <div className="cat-row__main">
                <p className="cat-row__title">{doctor.full_name}</p>
                <p className="cat-row__meta">
                  {DENTAL_SPECIALTY_LABEL[doctor.specialty]}
                  {formatRating(doctor.rating_average, doctor.rating_count)
                    ? ` · ${formatRating(doctor.rating_average, doctor.rating_count)}`
                    : ''}
                </p>
                <div className="cat-row__badges">
                  <Badge tone={doctor.is_active ? 'active' : 'inactive'}>
                    {doctor.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
              <div className="cat-row__actions">
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(doctor)}>
                  Edit
                </button>
                <Link
                  className="button button--ghost button--sm"
                  to={`/catalog/dental/doctors/${doctor.id}/ratings`}
                  aria-label={`Ratings for ${doctor.full_name}`}
                >
                  Ratings
                </Link>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => void toggleActive(doctor)}
                >
                  {doctor.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="page__note">
        The API supports creating and updating doctors; it has no delete endpoint, so deactivation is the way to
        retire one.
      </p>

      {editing ? (
        <DoctorDialog
          doctor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function DoctorDialog({
  doctor,
  onClose,
  onSaved,
}: {
  doctor: DentalDoctor | null;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [form, setForm] = useState({
    full_name: doctor?.full_name ?? '',
    specialty: doctor?.specialty ?? DENTAL_SPECIALTIES[0],
    photo_url: doctor?.photo_url ?? '',
    bio: doctor?.bio ?? '',
    is_active: doctor?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.full_name.trim().length < 2) next.full_name = 'Name must be at least 2 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    const payload = {
      full_name: form.full_name.trim(),
      specialty: form.specialty,
      photo_url: form.photo_url.trim() || null,
      bio: form.bio.trim() || null,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (doctor) {
        await dental.doctors.update(doctor.id, payload);
      } else {
        await dental.doctors.create(payload);
      }
      await onSaved();
    } catch (err) {
      setServerError(dentalErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Doctor">
      <form className="modal__panel modal__panel--wide" onSubmit={submit}>
        <h2 className="modal__title">{doctor ? 'Edit doctor' : 'Add doctor'}</h2>
        <Field label="Full name" error={errors.full_name}>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
        </Field>
        <Field label="Specialty">
          <select
            className="input"
            value={form.specialty}
            onChange={(e) => setForm({ ...form, specialty: e.target.value as DentalSpecialty })}
          >
            {DENTAL_SPECIALTIES.map((specialty) => (
              <option key={specialty} value={specialty}>
                {DENTAL_SPECIALTY_LABEL[specialty]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Photo URL" hint="Optional">
          <input
            className="input"
            value={form.photo_url}
            onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
          />
        </Field>
        <Field label="Bio" hint="Optional, shown on the doctor's profile">
          <textarea className="input" rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          />
          <span>
            <strong>Active</strong>
            <em>Inactive doctors can't be attached to a clinic or booked.</em>
          </span>
        </label>
        {serverError ? (
          <p className="field__error" role="alert">
            {serverError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
