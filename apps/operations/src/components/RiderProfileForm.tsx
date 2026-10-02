import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { delivery as deliveryApi } from '../api/resources';
import type { RiderProfile, VehicleType } from '../api/types';
import { errorMessage } from '../lib/errors';

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  BICYCLE: 'Bicycle',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
};

const VEHICLES = Object.keys(VEHICLE_LABEL) as VehicleType[];

export const vehicleLabel = (type: string) => VEHICLE_LABEL[type as VehicleType] ?? type;

/**
 * Sets up the signed-in operator's own rider profile (staff riders,
 * POST /riders/me/profile), or changes the vehicle on it. The profile is
 * active as soon as it is saved: the store can assign them orders and the
 * Delivery tab works like the Rider app. Field checks here are courtesy -
 * the API validates the same rules.
 */
export function RiderProfileForm({
  current,
  submitLabel,
  onSaved,
}: {
  current?: RiderProfile | null;
  submitLabel: string;
  onSaved(profile: RiderProfile): void | Promise<void>;
}) {
  const [vehicleType, setVehicleType] = useState<VehicleType>(
    current && VEHICLES.includes(current.vehicle_type as VehicleType) ? (current.vehicle_type as VehicleType) : 'MOTORCYCLE'
  );
  const [registration, setRegistration] = useState(current?.vehicle_registration_number ?? '');
  const [emergency, setEmergency] = useState(current?.emergency_contact_phone ?? '');
  const [errors, setErrors] = useState<Partial<Record<'registration' | 'emergency' | 'form', string>>>({});
  const [saving, setSaving] = useState(false);
  const typeId = useId();
  const regId = useId();
  const phoneId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    const reg = registration.trim();
    if (reg.length < 2) found.registration = 'Enter the number plate, e.g. WP BCX-8842.';
    if (reg.length > 32) found.registration = 'Use at most 32 characters.';
    if (emergency.trim() && !/^\+?[0-9 ()-]{1,20}$/.test(emergency.trim())) {
      found.emergency = 'Digits only, e.g. 077 123 4567.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const profile = await deliveryApi.setUpProfile({
        vehicle_type: vehicleType,
        vehicle_registration_number: reg,
        emergency_contact_phone: emergency.trim() || null,
      });
      await onSaved(profile);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RIDER_PROFILE_DISABLED') {
        setErrors({ form: 'Delivering was switched off for your account. Ask an admin to turn "Can deliver" back on.' });
      } else {
        setErrors({ form: errorMessage(err, 'Could not save your rider profile.') });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card rider-setup" onSubmit={submit} noValidate aria-label="Rider profile">
      <label className="field" htmlFor={typeId}>
        <span className="field__label">Vehicle</span>
        <select
          id={typeId}
          className="input"
          value={vehicleType}
          onChange={(e) => setVehicleType(e.target.value as VehicleType)}
        >
          {VEHICLES.map((v) => (
            <option key={v} value={v}>
              {VEHICLE_LABEL[v]}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor={regId}>
        <span className="field__label">Registration number</span>
        <input
          id={regId}
          className="input input--mono"
          value={registration}
          maxLength={32}
          autoCapitalize="characters"
          placeholder="WP BCX-8842"
          onChange={(e) => setRegistration(e.target.value)}
          aria-invalid={errors.registration ? true : undefined}
        />
        {errors.registration ? <span className="field__error-text">{errors.registration}</span> : null}
      </label>
      <label className="field" htmlFor={phoneId}>
        <span className="field__label">Emergency contact (optional)</span>
        <input
          id={phoneId}
          className="input"
          type="tel"
          inputMode="tel"
          value={emergency}
          maxLength={20}
          placeholder="077 123 4567"
          onChange={(e) => setEmergency(e.target.value)}
          aria-invalid={errors.emergency ? true : undefined}
        />
        {errors.emergency ? <span className="field__error-text">{errors.emergency}</span> : null}
      </label>
      {errors.form ? (
        <p className="field__error" role="alert">
          {errors.form}
        </p>
      ) : null}
      <button type="submit" className="primary" disabled={saving}>
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
