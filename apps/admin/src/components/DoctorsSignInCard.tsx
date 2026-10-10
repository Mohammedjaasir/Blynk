import { useEffect, useState } from 'react';
import { settings } from '../api/resources';
import type { DoctorsAccessSetting } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { Spinner, useToast } from './ui';

/**
 * Doctors -> "Doctors need sign-in" (owner, 2026-10-10: "For the doctor
 * thing, they must add their phone number and get registered. Otherwise it
 * should not show the doctor things."). On by default; flipping the switch
 * saves at once (PATCH /admin/settings/doctors-access, audited). Operations
 * has the same switch on its Doctors page.
 */
export function DoctorsSignInCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<DoctorsAccessSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settings
      .getDoctorsAccess()
      .then((s) => !cancelled && setCurrent(s))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the doctors sign-in setting.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(requireSignIn: boolean) {
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await settings.setDoctorsAccess(requireSignIn);
      setCurrent(saved);
      toast.success(
        saved.require_sign_in
          ? 'Saved. Customers must sign in to see doctors.'
          : 'Saved. Anyone can see doctors without signing in.'
      );
    } catch (err) {
      setSaveError(errorMessage(err, 'Could not save the doctors sign-in setting.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Who can see doctors">
      <h2 className="panel__title">Who can see doctors</h2>
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
            Doctors need sign-in
            <em>
              When on, customers must log in or create an account with their phone number before the app shows clinics
              and doctors. When off, anyone can see doctors; booking always needs sign-in.
            </em>
          </span>
        </label>
      )}
      {saveError ? (
        <p className="field__error" role="alert">
          {saveError}
        </p>
      ) : null}
    </section>
  );
}
