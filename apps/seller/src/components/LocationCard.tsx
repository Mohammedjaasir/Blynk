import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { sellerApi } from '../api/resources';
import type { LatLng, Seller } from '../api/types';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import {
  FALLBACK_STORE,
  formatKm,
  geoMessage,
  insideSriLanka,
  kmBetween,
  locateOnce,
  mapStart,
  roundPoint,
  samePoint,
  shopLocation,
  startNote,
} from '../lib/location';
import { IconAlert, IconCheckCircle, IconClock, IconInfo, IconPin } from './icons';
import { Illustration } from './Illustration';
import { ShopMap, type MapStatus, type ShopMapHandle } from './ShopMap';
import { Field, describedBy } from './ui';

export const LOCATION_NOT_READY_MESSAGE = 'Shop location will be available shortly.';

type Banner = { tone: 'ok' | 'wait' | 'bad' | 'info'; title: string; text?: string } | null;

/**
 * "Shop location": move the map under the fixed pin (or use the phone's
 * location), add a landmark, and send it. Blynk approves every location;
 * the approved one is where delivery charges for this seller's products are
 * worked out from.
 */
export function LocationCard({
  seller,
  locked,
  onSaved,
}: {
  seller: Seller;
  locked: boolean;
  onSaved(seller: Seller): Promise<void> | void;
}) {
  const location = shopLocation(seller);
  const hasPoint = Boolean(location.approved || location.pending);
  const [store, setStore] = useState<LatLng | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [start, setStart] = useState<LatLng | null>(null);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [moved, setMoved] = useState(false);
  const [moving, setMoving] = useState(false);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [note, setNote] = useState(startNote(location));
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [pointError, setPointError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [result, setResult] = useState<Banner>(null);
  const [saving, setSaving] = useState(false);
  const mapRef = useRef<ShopMapHandle>(null);

  // Where the Blynk store is (public GET /store); a missing or older answer falls back to the clock tower.
  useEffect(() => {
    let alive = true;
    sellerApi
      .store()
      .then((info) => {
        if (!alive) return;
        const p = info?.store_location;
        setStore(p && typeof p.lat === 'number' && typeof p.lng === 'number' ? { lat: p.lat, lng: p.lng } : null);
      })
      .catch(() => alive && setStore(null))
      .finally(() => alive && setStoreReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Open the map once: on the shop's own pin straight away, else wait for the store's location.
  useEffect(() => {
    if (start) return;
    if (hasPoint || storeReady) {
      const s = mapStart(location, store);
      setStart(s);
      setCenter(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPoint, storeReady, store, start]);

  const storePoint = store ?? FALLBACK_STORE;
  const liveKm = center ? kmBetween(center, storePoint) : null;
  const shown = (location.status === 'PENDING' || location.status === 'REJECTED') && location.pending ? location.pending : location.approved;
  const shownNote = startNote(location);
  const unchanged = Boolean(center && shown && samePoint(roundPoint(center), roundPoint(shown)) && note.trim() === shownNote.trim());
  const needsMove = !hasPoint && !moved;
  const canSend = !locked && !saving && Boolean(center) && !needsMove && !(unchanged && location.status !== 'REJECTED');

  const status: Banner = useMemo(() => {
    if (location.status === 'PENDING') {
      return {
        tone: 'wait',
        title: 'Waiting for Blynk to approve this location.',
        text: location.approved
          ? 'Your new pin is shown on the map. Until Blynk approves it, delivery charges use your approved location (the dark dot).'
          : 'Your pin is shown on the map. Blynk usually checks it within a day.',
      };
    }
    if (location.status === 'APPROVED') {
      return { tone: 'ok', title: 'Approved - delivery charges are worked out from here.' };
    }
    if (location.status === 'REJECTED') {
      return {
        tone: 'bad',
        title: `Not approved${location.rejectReason ? `: ${location.rejectReason}` : ''} - move the pin and send again.`,
      };
    }
    return null;
  }, [location.status, location.approved, location.rejectReason]);

  function handleMove(p: LatLng) {
    setCenter(p);
  }

  function handleMoving(next: boolean) {
    setMoving(next);
    if (next) {
      setMoved(true);
      setPointError(null);
      setResult(null);
    }
  }

  async function locateMe() {
    setGeoError(null);
    setPointError(null);
    setLocating(true);
    try {
      const fix = await locateOnce();
      if (!insideSriLanka(fix)) {
        setGeoError('Your phone says you are outside Sri Lanka. Move the map by hand so the pin sits on your shop.');
        return;
      }
      setMoved(true);
      setCenter(fix);
      mapRef.current?.flyTo(fix);
    } catch (err) {
      setGeoError(geoMessage(err));
    } finally {
      setLocating(false);
    }
  }

  async function send() {
    if (!center) return;
    setResult(null);
    setPointError(null);
    setNoteError(null);
    const p = roundPoint(center);
    if (!insideSriLanka(p)) {
      setPointError('That spot is outside Sri Lanka. Move the map so the pin sits on your shop.');
      return;
    }
    const landmark = note.trim();
    if (landmark.length > 255) {
      setNoteError('The landmark is too long (255 letters at most).');
      return;
    }
    setSaving(true);
    try {
      // Only the shop name (required by the API) and the point: the other details stay as they are.
      const response = await sellerApi.sendLocation({
        shop_name: seller.shop_name,
        latitude: p.lat,
        longitude: p.lng,
        location_note: landmark || null,
      });
      setMoved(false);
      // Sending the approved point back unchanged simply cancels a waiting change.
      setResult(
        response.seller.location_status === 'APPROVED'
          ? { tone: 'ok', title: 'Back to your approved location.', text: 'Nothing is waiting for Blynk now.' }
          : {
              tone: 'ok',
              title: 'Location sent to Blynk.',
              text: location.approved
                ? 'Blynk will check it. Your approved location stays in use until then.'
                : 'Blynk will check it and let you know.',
            }
      );
      await onSaved(response.seller);
    } catch (err) {
      if (notReady(err)) return;
      const fields = fieldErrors(err);
      if (fields.latitude || fields.longitude) {
        setPointError(fields.latitude ?? fields.longitude ?? null);
        return;
      }
      if (fields.location_note) {
        setNoteError(fields.location_note);
        return;
      }
      setResult({ tone: 'bad', title: errorMessage(err, 'Could not send the location. Please try again.') });
    } finally {
      setSaving(false);
    }
  }

  /** 503 LOCATION_NOT_READY: the server does not have the location change yet. Said gently. */
  function notReady(err: unknown): boolean {
    if (!(err instanceof ApiError && (err.code === 'LOCATION_NOT_READY' || err.status === 503))) return false;
    setResult({
      tone: 'info',
      title: err.code === 'LOCATION_NOT_READY' && err.message ? err.message : LOCATION_NOT_READY_MESSAGE,
      text: 'Your pin was not saved yet. Please try again a little later.',
    });
    return true;
  }

  /** Withdraw the waiting pin (null + null); an approved point stays in use. */
  async function cancelRequest() {
    setResult(null);
    setPointError(null);
    setNoteError(null);
    setSaving(true);
    try {
      const response = await sellerApi.sendLocation({ shop_name: seller.shop_name, latitude: null, longitude: null });
      setMoved(false);
      setResult({
        tone: 'ok',
        title: 'Request cancelled.',
        text: location.approved ? 'Your approved location stays in use.' : 'Pin your shop again whenever you are ready.',
      });
      await onSaved(response.seller);
    } catch (err) {
      if (notReady(err)) return;
      if (err instanceof ApiError && err.code === 'LOCATION_NOT_PENDING') {
        setResult({ tone: 'info', title: 'Nothing is waiting for Blynk any more.', text: 'Blynk may have just checked it.' });
        await onSaved(seller);
        return;
      }
      setResult({ tone: 'bad', title: errorMessage(err, 'Could not cancel the request. Please try again.') });
    } finally {
      setSaving(false);
    }
  }

  const savedKm =
    location.status === 'PENDING' || location.status === 'REJECTED' ? location.pendingKm : location.approvedKm;

  return (
    <section id="location" className="bezel loc rise" style={{ ['--i' as string]: 1 }} aria-labelledby="loc-title" tabIndex={-1}>
      <div className="bezel__core loc__core">
        <header className="loc__head">
          <span className="loc__badge" aria-hidden="true">
            <IconPin size={22} />
          </span>
          <div className="loc__titles">
            <h2 id="loc-title" className="loc__title">
              Shop location
            </h2>
            <p className="loc__why">
              Customers' delivery charges for your products are worked out from your approved shop location.
            </p>
          </div>
        </header>

        {status ? <LocationNotice banner={status} testId="location-status" /> : null}

        <div className={`loc__map${moving ? ' is-moving' : ''}${mapStatus === 'ready' ? ' is-ready' : ''}`}>
          {start ? (
            <ShopMap
              ref={mapRef}
              start={start}
              store={store ?? FALLBACK_STORE}
              approved={location.status === 'PENDING' || location.status === 'REJECTED' ? location.approved : null}
              onMove={handleMove}
              onMoving={handleMoving}
              onStatus={setMapStatus}
              label="Map. Move it so the pin sits on your shop."
            />
          ) : null}
          {mapStatus !== 'ready' ? (
            <div className="loc__placeholder" aria-hidden={mapStatus !== 'failed'}>
              <Illustration name="map" />
              {mapStatus === 'failed' ? (
                <p role="status">The map could not load. Check your internet and open this page again.</p>
              ) : (
                <p>Loading the map...</p>
              )}
            </div>
          ) : null}
          {/* The pin stays in the middle; the map moves under it. Its tip marks the spot. */}
          <div className="loc__pin" aria-hidden="true">
            <svg viewBox="0 0 48 64" width="44" height="58">
              <path
                d="M24 2C12.4 2 3 11.2 3 22.6 3 38 24 60 24 60s21-22 21-37.4C45 11.2 35.6 2 24 2Z"
                fill="#FFE141"
                stroke="#1A1D2E"
                strokeWidth="2.5"
              />
              <circle cx="24" cy="22" r="8" fill="#1A1D2E" />
              <circle cx="24" cy="22" r="3.2" fill="#FFE141" />
            </svg>
            <span className="loc__shadow" />
          </div>
          {liveKm !== null && mapStatus === 'ready' ? (
            <p className="loc__readout" aria-live="polite">
              <span className="loc__dot" aria-hidden="true" />
              {formatKm(liveKm)} from the Blynk store
            </p>
          ) : null}
          <button
            type="button"
            className="loc__gps"
            onClick={() => void locateMe()}
            disabled={locked || locating}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="6.5" />
              <circle cx="12" cy="12" r="2.2" fill="currentColor" />
              <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
            </svg>
            {locating ? 'Finding you...' : 'Use my current location'}
          </button>
        </div>

        {geoError ? (
          <p className="loc__msg loc__msg--warn" role="alert">
            <IconInfo size={18} /> <span>{geoError}</span>
          </p>
        ) : null}
        {pointError ? (
          <p className="loc__msg loc__msg--bad" role="alert">
            <IconAlert size={18} /> <span>{pointError}</span>
          </p>
        ) : null}
        {needsMove && !locked ? (
          <p className="loc__hint">
            The map starts at the Blynk store. Drag it until the pin sits on your shop's door, or use your current location.
          </p>
        ) : null}

        <dl className="loc__facts">
          <div>
            <dt>Straight-line distance</dt>
            <dd>{savedKm !== null ? `${formatKm(savedKm)}` : 'Once saved'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              {location.status === 'APPROVED'
                ? 'Approved'
                : location.status === 'PENDING'
                  ? 'With Blynk'
                  : location.status === 'REJECTED'
                    ? 'Send again'
                    : 'Not pinned yet'}
            </dd>
          </div>
        </dl>

        <Field
          id="s-landmark"
          label="Landmark / how to find the shop"
          error={noteError}
          hint="For example: opposite the post office, blue gate, first floor."
        >
          <textarea
            id="s-landmark"
            rows={2}
            maxLength={255}
            value={note}
            disabled={locked}
            onChange={(e) => {
              setNote(e.target.value);
              setResult(null);
            }}
            aria-invalid={Boolean(noteError)}
            aria-describedby={describedBy('s-landmark', true, noteError)}
          />
        </Field>

        {result ? <LocationNotice banner={result} testId="location-result" live /> : null}

        <div className="loc__actions">
          <button type="button" className="button button--primary button--cta" disabled={!canSend} onClick={() => void send()}>
            {saving ? 'Sending...' : 'Send this location to Blynk'}
          </button>
          {location.status === 'PENDING' && !locked ? (
            <button type="button" className="button button--link" disabled={saving} onClick={() => void cancelRequest()}>
              Cancel request
            </button>
          ) : unchanged && location.status !== 'REJECTED' && !locked ? (
            <span className="loc__aside">Move the map to choose a different spot.</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function LocationNotice({ banner, testId, live }: { banner: NonNullable<Banner>; testId: string; live?: boolean }) {
  const icon =
    banner.tone === 'ok' ? (
      <IconCheckCircle size={20} />
    ) : banner.tone === 'wait' ? (
      <IconClock size={20} />
    ) : banner.tone === 'bad' ? (
      <IconAlert size={20} />
    ) : (
      <IconInfo size={20} />
    );
  return (
    <div className={`loc__notice loc__notice--${banner.tone}`} data-testid={testId} role={live ? 'status' : undefined}>
      <span className="loc__notice-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="loc__notice-title">{banner.title}</p>
        {banner.text ? <p className="loc__notice-text">{banner.text}</p> : null}
      </div>
    </div>
  );
}
