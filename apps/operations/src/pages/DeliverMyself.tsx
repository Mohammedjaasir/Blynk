import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { delivery as deliveryApi } from '../api/resources';
import type { RiderProfile } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { RiderProfileForm, vehicleLabel } from '../components/RiderProfileForm';
import { deliveryErrorMessage } from '../lib/delivery';

/**
 * More -> "Deliver orders myself" (staff riders, 2026-10-01). An Operations
 * or Admin account sets up its own rider profile here - vehicle and number
 * plate - and is a rider at once: listed and suggested when the store
 * assigns orders, two-order trips included, with the Delivery tab doing what
 * the Rider app does. Also where the vehicle is changed later. Switching
 * delivering off is an admin's call (Blynk Admin -> Staff accounts).
 */
export function DeliverMyself() {
  const { refreshRiderCapability } = useAuth();
  const [profile, setProfile] = useState<RiderProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    deliveryApi
      .profile()
      .then(setProfile)
      .catch((err) => setError(deliveryErrorMessage(err)));
  }, []);

  async function saved(next: RiderProfile) {
    const first = !profile;
    setProfile(next);
    setEditing(false);
    setNotice(first ? 'You can deliver now. Orders assigned to you appear in the Delivery tab.' : 'Vehicle saved.');
    await refreshRiderCapability();
  }

  return (
    <div className="page">
      <Link to="/more" className="link">
        ← Back to More
      </Link>
      <PageHeader title="Deliver orders myself" description="Take orders out yourself, like a rider." />

      {error ? <p className="field__error">{error}</p> : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {profile === undefined && !error ? (
        <p className="loading" role="status">
          Checking your rider profile…
        </p>
      ) : null}

      {profile === null ? (
        <>
          <p className="page__note">
            Add your vehicle and the store can assign you orders - one at a time or two on one trip. You then pick up,
            share your location on the way, hand over with the customer's 4-digit code and collect cash from the
            Delivery tab.
          </p>
          <RiderProfileForm submitLabel="Start delivering" onSaved={saved} />
        </>
      ) : null}

      {profile ? (
        <>
          <section className="card" aria-label="Your rider profile">
            <p className="card__row">
              <span className="card__label">Status</span>
              <span className="card__value">{profile.is_active ? 'Can deliver' : 'Switched off by an admin'}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Vehicle</span>
              <span className="card__value">{vehicleLabel(profile.vehicle_type)}</span>
            </p>
            <p className="card__row">
              <span className="card__label">Registration</span>
              <span className="card__value mono">{profile.vehicle_registration_number}</span>
            </p>
            {profile.emergency_contact_phone ? (
              <p className="card__row">
                <span className="card__label">Emergency contact</span>
                <span className="card__value mono">{profile.emergency_contact_phone}</span>
              </p>
            ) : null}
            {profile.is_active ? (
              <div className="deliver-actions">
                <Link to="/delivery" className="primary">
                  Go to my deliveries
                </Link>
                <button type="button" className="button button--ghost" onClick={() => setEditing((e) => !e)}>
                  {editing ? 'Cancel' : 'Change vehicle'}
                </button>
              </div>
            ) : (
              <p className="card__note">Ask an admin to turn "Can deliver" back on in Blynk Admin → Staff accounts.</p>
            )}
          </section>
          {editing && profile.is_active ? (
            <RiderProfileForm current={profile} submitLabel="Save vehicle" onSaved={saved} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
