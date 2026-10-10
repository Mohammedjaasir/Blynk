import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dental, settings } from '../../api/resources';
import type { DoctorsAccessSetting } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';
import { formatDateTime } from '../../lib/inventory';

/**
 * Dental hub (task F8, plan §15-19) - the entry point Catalog's own hub
 * links to (`/catalog/dental`), mirroring Inventory's own Overview-as-hub
 * pattern (F6) rather than a flat page, since this domain has two peer
 * top-level lists (clinics, doctors) plus a per-clinic detail screen nested
 * under Clinics, and a per-pairing availability screen nested under that.
 * Counts are real list lengths (both endpoints are deliberately unpaginated,
 * confirmed against the real backend - see `resources.ts`'s doc comment),
 * never fabricated (common.md rule 7); a card whose count fails to load just
 * shows no number rather than a guessed one (same convention as F5's
 * Catalog hub).
 *
 * Task F9 (plan §20) adds a third card, "Appointments" - not strictly
 * required by that task's own "Build src/pages/Dental/Appointments.tsx"
 * line, but disclosed per the process discipline F8's own report carried
 * forward from F6/F7's reviews: without this, the new screen would only be
 * reachable by hand-typing its URL, the same completeness gap F8's own "add
 * a Catalog hub card" judgment call closed for the whole Dental domain.
 * Today's count (not a total) comes from the real `pagination.total` the
 * list endpoint already returns for `from=to=today`, not `.length` capped
 * by a page size (common.md rule 7 - a real number, not a guess).
 */
export function Overview() {
  const [clinicCount, setClinicCount] = useState<number | null>(null);
  const [doctorCount, setDoctorCount] = useState<number | null>(null);
  const [appointmentsTodayCount, setAppointmentsTodayCount] = useState<number | null>(null);

  useEffect(() => {
    void dental.clinics
      .list()
      .then((rows) => setClinicCount(rows.length))
      .catch(() => setClinicCount(null));
    void dental.doctors
      .list()
      .then((rows) => setDoctorCount(rows.length))
      .catch(() => setDoctorCount(null));
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    void dental.appointments
      .list({ from: today, to: today, limit: 1 })
      .then((r) => setAppointmentsTodayCount(r.pagination.total))
      .catch(() => setAppointmentsTodayCount(null));
  }, []);

  return (
    <div className="page">
      <PageHeader title="Doctors" description="Clinics, doctors, appointments and bookable schedules for the customer app." />
      <ul className="cat-hub">
        <li>
          <Link className="cat-hub__card" to="/catalog/dental/appointments">
            <span className="cat-hub__title">Appointments</span>
            <span className="cat-hub__count">{appointmentsTodayCount === null ? '—' : appointmentsTodayCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/dental/clinics">
            <span className="cat-hub__title">Clinics</span>
            <span className="cat-hub__count">{clinicCount === null ? '—' : clinicCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/dental/doctors">
            <span className="cat-hub__title">Doctors</span>
            <span className="cat-hub__count">{doctorCount === null ? '—' : doctorCount}</span>
          </Link>
        </li>
      </ul>
      <DoctorsSignInCard />
    </div>
  );
}

/**
 * "Doctors need sign-in" (owner, 2026-10-10: "For the doctor thing, they
 * must add their phone number and get registered. Otherwise it should not
 * show the doctor things."). On by default; flipping the switch saves at
 * once (PATCH /admin/settings/doctors-access, audited) and the customer app
 * follows within about a minute.
 */
export function DoctorsSignInCard() {
  const [current, setCurrent] = useState<DoctorsAccessSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    settings.doctorsAccess
      .get()
      .then(setCurrent)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function change(requireSignIn: boolean) {
    setNotice(null);
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.doctorsAccess.update(requireSignIn);
      setCurrent(saved);
      setNotice(
        saved.require_sign_in
          ? 'Saved. Customers must sign in to see doctors.'
          : 'Saved. Anyone can see doctors without signing in.'
      );
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-labelledby="doctors-sign-in-title">
      <h2 className="section-label" id="doctors-sign-in-title">
        Who can see doctors
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the doctors sign-in setting" />
      ) : (
        <label className="toggle">
          <input
            type="checkbox"
            checked={current.require_sign_in}
            disabled={saving}
            onChange={(e) => void change(e.target.checked)}
          />
          <span>
            <strong>Doctors need sign-in</strong>
            <em>
              When on, customers must log in or create an account with their phone number before the app shows
              clinics and doctors. When off, anyone can see doctors; booking always needs sign-in.
            </em>
          </span>
        </label>
      )}
      {saving ? <Spinner label="Saving" /> : null}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
    </section>
  );
}
