import { useState } from 'react';
import { sellers as sellersApi } from '../../api/sellers';
import { ConfirmDialog } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { NOT_READY_TEXT, dayText, googleMapsUrl, notReady, type AdminSeller } from '../../lib/sellers';
import {
  EXTEND_DAYS,
  HOW_TO_FIND_MAX,
  colomboDayOf,
  daysLeftText,
  endOfColomboDay,
  extendedUntil,
  freePeriod,
  locationBody,
  parseCoordinate,
  parseLatLng,
  type LocationForm,
} from '../../lib/sellerShop';
import { Sheet, TextField } from './parts';
import './sellers.css';

/**
 * Staff set the shop location themselves (2026-10-30, for a seller who cannot pin it): it is written
 * as the APPROVED location. A pasted Google Maps "lat,lng" (or a maps link) fills both fields.
 */
export function SetLocationSheet({ seller, onClose, onSaved }: { seller: AdminSeller; onClose(): void; onSaved(s: AdminSeller | null): void }) {
  const [form, setForm] = useState<LocationForm>({
    latitude: typeof seller.latitude === 'number' ? String(seller.latitude) : '',
    longitude: typeof seller.longitude === 'number' ? String(seller.longitude) : '',
    how_to_find: seller.location_note ?? '',
  });
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<'latitude' | 'longitude' | 'how_to_find', string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lat = parseCoordinate(form.latitude, 'lat');
  const lng = parseCoordinate(form.longitude, 'lng');

  function onPaste(text: string) {
    setPaste(text);
    if (!text.trim()) {
      setPasteError(null);
      return;
    }
    const p = parseLatLng(text);
    if (!p) {
      setPasteError('Paste the position as "7.290572, 80.633728" or a Google Maps link.');
      return;
    }
    setPasteError(null);
    setForm((f) => ({ ...f, latitude: String(p.lat), longitude: String(p.lng) }));
    setErrors({});
  }

  async function save() {
    const read = locationBody(form);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setBusy(true);
    try {
      onSaved(await sellersApi.setLocation(seller.id, read.body));
    } catch (err) {
      setFormError(notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not save the shop location.'));
      setBusy(false);
    }
  }

  return (
    <Sheet
      label="Set shop location"
      title={`Shop location for ${seller.shop_name}`}
      message="Riders collect the seller's goods here and delivery is measured from it. It is approved straight away."
      busy={busy}
      submitLabel={busy ? 'Saving…' : 'Save location'}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <TextField label="Paste from Google Maps (lat,lng)" error={pasteError} hint="Long-press the shop on Google Maps, copy the numbers at the top and paste them here.">
        <input className="input" aria-label="Pasted position" placeholder="7.290572, 80.633728" value={paste} onChange={(e) => onPaste(e.target.value)} />
      </TextField>
      <TextField label="Latitude" error={errors.latitude ?? null}>
        <input
          className="input"
          inputMode="decimal"
          value={form.latitude}
          onChange={(e) => {
            setForm((f) => ({ ...f, latitude: e.target.value }));
            setErrors((x) => ({ ...x, latitude: undefined }));
            setFormError(null);
          }}
        />
      </TextField>
      <TextField label="Longitude" error={errors.longitude ?? null}>
        <input
          className="input"
          inputMode="decimal"
          value={form.longitude}
          onChange={(e) => {
            setForm((f) => ({ ...f, longitude: e.target.value }));
            setErrors((x) => ({ ...x, longitude: undefined }));
            setFormError(null);
          }}
        />
      </TextField>
      <TextField label="How to find it (optional)" error={errors.how_to_find ?? null} hint="Shown to riders, e.g. next to the bus stand, green gate.">
        <input
          className="input"
          maxLength={HOW_TO_FIND_MAX}
          value={form.how_to_find}
          onChange={(e) => {
            setForm((f) => ({ ...f, how_to_find: e.target.value }));
            setErrors((x) => ({ ...x, how_to_find: undefined }));
          }}
        />
      </TextField>
      {lat !== null && lng !== null ? (
        <a className="button" style={{ minHeight: 44, textAlign: 'center' }} href={googleMapsUrl({ lat, lng })} target="_blank" rel="noopener noreferrer">
          Open in Google Maps
        </a>
      ) : null}
      {formError ? (
        <p className="field__error" role="alert">
          {formError}
        </p>
      ) : null}
    </Sheet>
  );
}

/**
 * The commission-free period inside the Commission card (migration 065): "Commission-free until
 * <date> (N days left)" with Edit date / Extend by 30 days / End now. Nothing on an older API.
 */
export function FreePeriodControl({ seller, onChanged, onNotify }: { seller: AdminSeller; onChanged(s: AdminSeller): void; onNotify(text: string): void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [day, setDay] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (seller.commission_free_until === undefined) return null;
  const period = freePeriod(seller.commission_free_until);

  async function change(until: string | null, done: string) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await sellersApi.update(seller.id, { commission_free_until: until }));
      onNotify(done);
      return true;
    } catch (err) {
      const text = notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not change the commission-free period.');
      setError(text);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const summary =
    period.state === 'active'
      ? `Commission-free until ${dayText(period.until)} (${daysLeftText(period.daysLeft)})`
      : period.state === 'ended'
        ? `The commission-free period ended on ${dayText(period.until)}. Normal rates apply.`
        : 'No commission-free period. Normal rates apply from the first sale.';

  return (
    <div className="seller-free" role="group" aria-label="Commission-free period">
      <h3 className="seller-point__title">Commission-free period</h3>
      <p className="seller-free__summary">{summary}</p>
      <div className="sellers-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            setDay(period.state === 'none' ? '' : colomboDayOf(period.until));
            setError(null);
            setEditing(true);
          }}
        >
          Edit date
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void change(extendedUntil(seller.commission_free_until), `Commission-free period extended by ${EXTEND_DAYS} days.`)}>
          Extend by {EXTEND_DAYS} days
        </button>
        {period.state === 'active' ? (
          <button type="button" className="button button--danger" disabled={busy} onClick={() => setEnding(true)}>
            End now
          </button>
        ) : null}
      </div>
      {error && !editing ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {editing ? (
        <Sheet
          label="Edit commission-free date"
          title="Commission-free until"
          message="The last day Blynk takes no commission from this seller's deliveries. Orders delivered after it use the normal rates."
          busy={busy}
          submitLabel={busy ? 'Saving…' : 'Save date'}
          onClose={() => setEditing(false)}
          onSubmit={() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
              setError('Choose the last commission-free day.');
              return;
            }
            void change(endOfColomboDay(day), `Commission-free until ${dayText(day)}.`).then((saved) => saved && setEditing(false));
          }}
        >
          <TextField label="Last commission-free day" error={error}>
            <input
              className="input"
              type="date"
              aria-label="Last commission-free day"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setError(null);
              }}
            />
          </TextField>
        </Sheet>
      ) : null}

      {ending ? (
        <ConfirmDialog
          title="End the commission-free period now?"
          message="Orders delivered from now on use the normal commission rates."
          confirmLabel={busy ? 'Ending…' : 'End now'}
          destructive
          onConfirm={() => {
            if (busy) return;
            void change(new Date().toISOString(), 'Commission-free period ended.').then(() => setEnding(false));
          }}
          onCancel={() => setEnding(false)}
        />
      ) : null}
    </div>
  );
}
