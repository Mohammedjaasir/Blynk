import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
  type KeyboardTypeOptions,
} from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, interpolateColor, LinearTransition, SlideInDown, useAnimatedStyle, useSharedValue, withSequence,
  withTiming, ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrackOnce } from '@/blynk/analytics/AnalyticsHost';
import { trackOutOfZone } from '@/blynk/analytics/track';
import { AreaIntro } from '@/blynk/area/AreaSteps';
import { AREA, noteText } from '@/blynk/area/copy';
import { areaChoices, areaOfPin, circleRing, coverageOf, insideCoverage, isDefaultPin, kmText, nearestPlace, type Coverage } from '@/blynk/area/coverage';
import { cityFor, flowReducer, gpsFailureOf, initialFlow, leavesScreen } from '@/blynk/area/flow';
import { formatPhone } from '@/blynk/auth/phone';
import { useSession } from '@/blynk/auth/session';
import { useStore } from '@/blynk/store/StoreContext';
import { BackIcon, CloseIcon } from '@/components/icons';
import { PressScale, Skeleton } from '@/components/ui';
import { ADDRESS as VIDEO } from '@/demo/cart';
import { useCartSelect } from '@/lib/cart';
import { withSpring } from '@/lib/motion';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';
import { addressErrorText, isOutsideRadius, type SavedAddress, type UpdateAddressBody } from './api';
import {
  COPY, DEFAULT_LABEL, metresBetween, numParam, safeReturn, townFromHub, validateAddress,
  type AddressFields, type FieldErrors, type Pin as LatLng,
} from './forms';
import {
  loadMapLibre, locateOnce, MAP_ATTRIBUTION, MAP_STYLE, MAP_ZOOM, type MlMap,
} from './maplibre';
import { Pin, PIN_GROUND_Y, SmallPin, TargetIcon } from './pins';
import {
  getLocationState, markSheetDone, saveAddressEdit, saveNewAddress, setGuestLocation, useDeliveryLocation,
} from './store';

/** Pin head centre, from the video: x = centre + 6, y = top inset + 346 (as the design-mock screen). */
const PIN_DX = 6;
const PIN_Y = 346;
/** The pin block: tooltip (37 + 8 arrow) + 8 gap above the pin, so the pin's top is at PIN_Y - 17. */
const PIN_TOP = PIN_Y - 17;
/** Zoom for each way into the map: the store (see the streets around it), an area's centre, a GPS fix. */
const ZOOM = { store: 15, area: 15.5, gps: 17 } as const;

const T = {
  search: 'Move the map to your delivery spot',
  moving: VIDEO.loadingHint, // "Order will be delivered here"
  placed: VIDEO.placedHint, // "Place the pin at exact delivery location"
  mustMove: 'Move the map so the pin sits on your house',
  area: 'Area',
  spot: 'Your delivery spot',
  spotLine: "You'll add the house number and street next.",
  cta: VIDEO.cta, // "Confirm & proceed"
  current: VIDEO.current,
  locating: 'Finding you…',
  gpsOff: "We couldn't get your location. Move the map to your delivery spot.",
  mapFailed: "The map didn't load. Check your connection and try again.",
  retry: 'Try again',
  web: 'The map opens in the Blynk web app.',
  addTitle: 'Add address details',
  editTitle: 'Edit address',
  change: 'Change',
  pinSet: 'Pin placed on the map',
  save: 'Save address',
  saving: 'Saving…',
  guestNote: "We'll keep this on your phone and save it to your account when you sign in.",
  movePin: 'Move the pin',
  gone: 'This address no longer exists.',
};

/** The delivery circle and the store on the MapLibre picker (drawn once the style has loaded). */
function drawCoverage(map: MlMap, c: Coverage) {
  try {
    map.addSource('blynk-area', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(c)] } } });
    map.addLayer({ id: 'blynk-area-fill', type: 'fill', source: 'blynk-area', paint: { 'fill-color': C.brand, 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'blynk-area-line', type: 'line', source: 'blynk-area', paint: { 'line-color': C.brandDeep, 'line-width': 2.5, 'line-dasharray': [3, 2] } });
    map.addSource('blynk-store', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [c.center.lng, c.center.lat] } } });
    map.addLayer({ id: 'blynk-store', type: 'circle', source: 'blynk-store', paint: { 'circle-radius': 7, 'circle-color': C.brand, 'circle-stroke-color': C.brandInk, 'circle-stroke-width': 2 } });
  } catch { /* the overlay is a guide only; the picker works without it */ }
}

export function LiveAddressScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const params = useLocalSearchParams<{ return?: string; lat?: string; lng?: string; id?: string; gps?: string }>();
  const ret = safeReturn(params.return);
  const session = useSession();
  const loc = useDeliveryLocation();
  const store = useStore();
  const coverage = coverageOf(store);
  const cartPhone = useCartSelect((c) => c.phone);
  const town = townFromHub(store?.hub_name);

  const editId = typeof params.id === 'string' && params.id ? params.id : null;
  const editing: SavedAddress | null = editId && session ? loc.addresses?.find((a) => a.id === editId) ?? null : null;
  // editing after a reload: wait for the address book before placing the map
  const waiting = !!editId && !!session && !editing && (loc.loading || !loc.addresses);
  const gone = !!editId && !!session && !editing && !waiting;

  // area map first, then GPS / drag the pin / choose the area (src/blynk/area/flow.ts)
  const [flow, dispatch] = useReducer(flowReducer, undefined, () => initialFlow({
    coverage,
    fix: { lat: numParam(params.lat) ?? NaN, lng: numParam(params.lng) ?? NaN },
    gpsOff: params.gps === 'off',
    edit: !!editId,
    editing: editing ? { lat: editing.latitude, lng: editing.longitude } : null,
  }));
  const step = flow.step;
  const onMap = step === 'map' || step === 'form';
  // the map is created the first time it is needed and kept under the area screens after that
  const [mapOn, setMapOn] = useState(onMap);
  if (onMap && !mapOn) setMapOn(true);

  const [pin, setPin] = useState<LatLng | null>(null);
  const [moving, setMoving] = useState(false);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [mapTry, setMapTry] = useState(0);
  const [tip, setTip] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [outOfArea, setOutOfArea] = useState(false);
  // the pin came from the phone's location (or the customer moved it): then it may rest anywhere. Otherwise
  // it must not stay on a spot we made up (the store, an area's middle) - owner, 2026-10-22.
  const [chosen, setChosen] = useState(!flow.fresh && !editId);

  const hostRef = useRef<View>(null);
  const mapRef = useRef<MlMap | null>(null);
  const lift = useSharedValue(0);

  // a new way into the map (GPS fix, the store, an area): say what to do there
  const [seenKey, setSeenKey] = useState(flow.startKey);
  if (seenKey !== flow.startKey) {
    setSeenKey(flow.startKey);
    setOutOfArea(false);
    setChosen(!flow.fresh);
    setNote(flow.area ? AREA.areaLine(flow.area.name) : noteText(flow.note === 'areaPicked' ? null : flow.note));
  }

  const zoomFor = () => (flow.area ? ZOOM.area : flow.note === 'drag' ? ZOOM.store : editing ? MAP_ZOOM.start : ZOOM.gps);

  // the camera centre sits under the pin's tail dot, not the middle of the screen
  const ground = { x: width / 2 + PIN_DX, y: insets.top + PIN_TOP + PIN_GROUND_Y };
  const padding = useMemo(() => {
    const dy = 2 * ground.y - height;
    return { left: 2 * PIN_DX, right: 0, top: Math.max(0, dy), bottom: Math.max(0, -dy) };
  }, [ground.y, height]);

  useEffect(() => {
    if (Platform.OS !== 'web' || waiting || gone || !mapOn) return;
    let alive = true;
    loadMapLibre()
      .then((ml) => {
        const el = hostRef.current as unknown as HTMLElement | null;
        if (!alive || !el) return;
        // where the map opens: the address being edited, else where the flow says (GPS fix, store, area centre)
        const start = editing ? { lat: editing.latitude, lng: editing.longitude } : flow.start;
        setPin(start);
        const map = new ml.Map({
          container: el,
          style: MAP_STYLE,
          center: [start.lng, start.lat],
          zoom: zoomFor(),
          minZoom: MAP_ZOOM.min,
          maxZoom: MAP_ZOOM.max,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: false,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.setPadding(padding);
        map.jumpTo({ center: [start.lng, start.lat] });
        map.on('movestart', (e) => {
          const user = !!(e as { originalEvent?: unknown } | undefined)?.originalEvent;
          setMoving(true);
          setOutOfArea(false);
          lift.set(withSpring(1, { damping: 14, stiffness: 260 }));
          if (user) { setTip(false); setNote(null); }
        });
        map.on('moveend', () => {
          const c = map.getCenter();
          setPin({ lat: c.lat, lng: c.lng });
          setMoving(false);
          lift.set(withSequence(withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }), withSpring(0)));
        });
        map.once('load', () => {
          if (!alive) return;
          drawCoverage(map, coverage);
          setMapState('ready');
        });
        mapRef.current = map;
      })
      .catch(() => { if (alive) setMapState('failed'); });
    return () => {
      alive = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, gone, mapTry, mapOn]);

  useEffect(() => { mapRef.current?.setPadding(padding); }, [padding]);

  // ...and move the open map there
  useEffect(() => {
    const s = flow.start;
    if (flow.startKey > 0) mapRef.current?.jumpTo({ center: [s.lng, s.lat], zoom: zoomFor() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.startKey]);

  const toCurrent = () => {
    if (locating) return;
    setLocating(true);
    setNote(null);
    locateOnce()
      .then((p) => { setChosen(true); mapRef.current?.easeTo({ center: [p.lng, p.lat], zoom: Math.max(MAP_ZOOM.start, ZOOM.gps), duration: 600 }); })
      .catch((e) => setNote(noteText(gpsFailureOf(e)) ?? T.gpsOff))
      .finally(() => setLocating(false));
  };

  /** The area screen's "Use my current location": one fix, else stay with the GPS-free ways. */
  const askGps = () => {
    if (flow.asking) return;
    dispatch({ type: 'useGps' });
    locateOnce()
      .then((fix) => dispatch({ type: 'gpsOk', fix, coverage }))
      .catch((e) => dispatch({ type: 'gpsFail', reason: gpsFailureOf(e) }));
  };

  const pinA = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * 16 }] }));
  const placed = !!pin && !moving && mapState === 'ready';
  // the drawn circle: outside it, "Confirm & proceed" is withheld until the pin moves back in
  // (owner, 2026-10-16); the server still has the final say once the address is saved
  const far = pin ? insideCoverage(coverage, pin) : null;
  const outside = !!far && !far.inside;
  const near = pin ? nearestPlace(coverage, pin) : null;
  // still on a spot we made up: no "Confirm & proceed" until the pin is placed by the customer or the phone
  const mustMove = placed && !chosen && !!pin && isDefaultPin(coverage, pin);
  const city = pin ? areaOfPin(coverage, pin) : cityFor(flow, town);
  useTrackOnce(placed && outside, 'out_of_zone', () => trackOutOfZone(near?.name ?? city)); // GTM: the pin settled outside the circle
  const title = editing ? editing.address_line1 : flow.area ? flow.area.name : T.spot;
  const line = editing ? editing.city
    : [near && !flow.area ? AREA.near(near.name) : city, far ? (far.km >= 0.1 ? `${kmText(far.km)} ${AREA.fromStore}` : null) : T.spotLine]
      .filter(Boolean).join(' · ');

  const leave = () => (ret ? router.dismissTo(ret as never) : goBack());
  const back = () => (leavesScreen(flow) ? leave() : dispatch({ type: 'back' }));

  return (
    <Animated.View entering={FadeIn.duration(110)} style={{ flex: 1, backgroundColor: '#EFEBE3' }}>
      <StatusBar style="dark" />

      {/* the map: MapLibre needs a plain block element with a size (its CSS makes it position: relative) */}
      <View style={StyleSheet.absoluteFill}>
        {Platform.OS === 'web' && mapOn && !waiting && !gone && <View key={mapTry} ref={hostRef} style={{ width: '100%', height: '100%' }} />}
      </View>
      {onMap && (mapState === 'loading' || waiting) && !gone && Platform.OS === 'web' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.mapLoading]}><ActivityIndicator color={C.brandInk} /></View>
      )}
      {onMap && (mapState === 'failed' || Platform.OS !== 'web' || gone) && (
        <View style={[StyleSheet.absoluteFill, styles.mapLoading]}>
          <Text style={styles.failTxt}>{gone ? T.gone : Platform.OS !== 'web' ? T.web : T.mapFailed}</Text>
          {mapState === 'failed' && !gone && (
            <PressScale onPress={() => { setMapState('loading'); setMapTry((n) => n + 1); }} style={styles.retry}><Text style={styles.retryTxt}>{T.retry}</Text></PressScale>
          )}
        </View>
      )}

      {/* fixed centre pin + tooltip */}
      {onMap && mapState === 'ready' && (
        <View pointerEvents="box-none" style={[styles.pinWrap, { left: width / 2 + PIN_DX - 140, top: insets.top + PIN_Y - 70 }]}>
          {tip ? (
            <Animated.View exiting={ZoomOut.duration(150)} style={{ alignItems: 'center' }}>
              <View style={styles.tip}>
                <Text style={styles.tipTxt}>{VIDEO.tip}</Text>
                <Pressable hitSlop={10} onPress={() => setTip(false)} style={styles.tipX}><CloseIcon size={8} color="#fff" stroke={3} /></Pressable>
              </View>
              <View style={styles.tipArrow} />
            </Animated.View>
          ) : (
            <View style={{ height: 45 }} />
          )}
          <Animated.View pointerEvents="none" style={[{ marginTop: 8 }, pinA]}>
            <Pin />
          </Animated.View>
        </View>
      )}

      {/* back + hint pill */}
      {onMap && (
        <>
          <View style={[styles.top, { top: insets.top + 24 }]}>
            <PressScale onPress={back} style={styles.backBtn}><BackIcon size={19} color="#111" stroke={2} /></PressScale>
            <View style={styles.search}>
              <SmallPin />
              <Text style={styles.searchTxt} numberOfLines={1}>{T.search}</Text>
            </View>
          </View>
          <Text style={[styles.attrib, { top: insets.top + 66 }]} pointerEvents="none">{`OpenFreeMap © OpenMapTiles ${MAP_ATTRIBUTION}`}</Text>
        </>
      )}

      {/* bottom: current location pill + place card */}
      {onMap && (
        <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 0) + 38 }]} pointerEvents="box-none">
          {!!note && (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.note}>
              <Text style={styles.noteTxt}>{note}</Text>
            </Animated.View>
          )}
          {Platform.OS === 'web' && !gone && (
            <Animated.View layout={LinearTransition.duration(140)} style={{ alignSelf: 'center' }}>
              <PressScale onPress={toCurrent} style={styles.current}>
                {locating ? <ActivityIndicator size="small" color={C.brandInk} /> : <TargetIcon />}
                <Text style={styles.currentTxt}>{locating ? T.locating : T.current}</Text>
              </PressScale>
            </Animated.View>
          )}
          <Animated.View layout={LinearTransition.duration(140)} style={styles.card}>
            {outOfArea || (placed && outside) ? (
              <View style={[styles.cardHead, styles.cardHeadBad]}>
                <Text style={[styles.cardHint, { color: C.problem, fontFamily: F.semi }]}>{outOfArea ? COPY.outTitle : AREA.farHead}</Text>
              </View>
            ) : (
              <View style={styles.cardHead}>
                <Text style={styles.cardHint}>{mustMove ? T.mustMove : placed ? T.placed : T.moving}</Text>
              </View>
            )}
            {placed ? (
              <Animated.View key="placed" entering={FadeIn.duration(140)} style={{ paddingHorizontal: 15, paddingTop: 15 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <SmallPin />
                  <Text style={styles.placeName} numberOfLines={1}>{title}</Text>
                </View>
                <Text style={styles.placeLine}>{outOfArea ? COPY.outBody : outside && far ? AREA.farLine(far.km, coverage) : line}</Text>
                {/* outside the area: move the pin to continue, no "Confirm & proceed" (owner, 2026-10-16) */}
                {outOfArea || outside || mustMove ? null : (
                  <PressScale onPress={() => dispatch({ type: 'confirmPin' })} style={styles.cta} haptic scaleTo={0.96}>
                    <Text style={styles.ctaTxt}>{T.cta}</Text>
                  </PressScale>
                )}
              </Animated.View>
            ) : (
              <View key="loading" style={{ paddingHorizontal: 15, paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <SmallPin />
                  <Skeleton h={22} r={6} style={{ flex: 1 }} />
                </View>
                <Skeleton h={22} r={6} style={{ marginTop: 8 }} />
              </View>
            )}
          </Animated.View>
        </View>
      )}

      {step === 'form' && pin && (
        <AddressForm
          pin={pin}
          area={city}
          choices={areaChoices(coverage)}
          editing={editing}
          signedIn={!!session}
          prefill={{
            name: session?.user.full_name ?? getLocationState().guest?.details?.recipient_name ?? '',
            phone: session ? formatPhone(session.user.phone) : getLocationState().guest?.details?.recipient_phone
              ? formatPhone(getLocationState().guest?.details?.recipient_phone as string) : cartPhone ?? '',
          }}
          onBack={() => dispatch({ type: 'back' })}
          onOutOfArea={() => { setOutOfArea(true); dispatch({ type: 'back' }); }}
          onDone={leave}
        />
      )}

      {/* the delivery-area map first, then the area list (laid over the map) */}
      {step === 'area' && (
        <AreaIntro
          coverage={coverage}
          note={flow.note}
          asking={flow.asking}
          onBack={leave}
          onGps={askGps}
          onDrag={() => dispatch({ type: 'dragPin', coverage })}
        />
      )}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ form step */

function AddressForm({ pin, area: autoArea, choices, editing, signedIn, prefill, onBack, onOutOfArea, onDone }: {
  pin: LatLng; area: string; choices: string[]; editing: SavedAddress | null; signedIn: boolean;
  prefill: { name: string; phone: string };
  onBack: () => void; onOutOfArea: () => void; onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const guest = getLocationState().guest;
  const [f, setF] = useState<AddressFields>(() => (editing ? {
    name: editing.recipient_name,
    phone: formatPhone(editing.recipient_phone),
    other: editing.alternate_phone ? formatPhone(editing.alternate_phone) : '',
    line: editing.address_line1,
    notes: editing.delivery_instructions ?? '',
  } : {
    name: prefill.name,
    phone: prefill.phone,
    other: !signedIn && guest?.details?.alternate_phone ? formatPhone(guest.details.alternate_phone) : '',
    line: !signedIn ? guest?.details?.address_line1 ?? '' : '',
    notes: !signedIn ? guest?.details?.delivery_instructions ?? '' : '',
  }));
  // the area comes from the pin; the customer can change it (owner, 2026-10-22: a Beruwala address was saved as Dharga Town)
  const [town, setTown] = useState(autoArea);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const put = (k: keyof AddressFields) => (t: string) => {
    setF((v) => ({ ...v, [k]: t }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    const { errors: errs, details } = validateAddress(f, pin);
    setErrors(errs);
    if (!details) return;
    setError(null);
    setOut(false);
    if (!signedIn) {
      setGuestLocation({ lat: pin.lat, lng: pin.lng, label: details.address_line1, details, city: town });
      onDone();
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        const patch: UpdateAddressBody = { ...details, city: town };
        if (metresBetween(pin, { lat: editing.latitude, lng: editing.longitude }) > 0.5) {
          patch.latitude = pin.lat;
          patch.longitude = pin.lng;
        }
        await saveAddressEdit(editing.id, patch);
      } else {
        await saveNewAddress({ label: DEFAULT_LABEL, ...details, city: town, latitude: pin.lat, longitude: pin.lng, is_default: true });
      }
      markSheetDone();
      if (mounted.current) onDone();
    } catch (e) {
      if (!mounted.current) return;
      if (isOutsideRadius(e)) { setOut(true); trackOutOfZone(town); }
      else setError(addressErrorText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Animated.View entering={SlideInDown.duration(220)} exiting={FadeOut.duration(120)} style={[StyleSheet.absoluteFill, styles.form]}>
      <View style={[styles.formHead, { paddingTop: insets.top + 14 }]}>
        <PressScale onPress={onBack} style={styles.backBtn}><BackIcon size={19} color="#111" stroke={2} /></PressScale>
        <Text style={styles.formTitle}>{editing ? T.editTitle : T.addTitle}</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: insets.bottom + 30 }}>
        <View style={styles.pinRow}>
          <SmallPin />
          <View style={{ flex: 1 }}>
            <Text style={styles.pinRowTitle}>{T.pinSet}</Text>
            <Text style={styles.pinRowSub}>{town}</Text>
          </View>
          <Pressable onPress={onBack} hitSlop={8}><Text style={styles.change}>{T.change}</Text></Pressable>
        </View>

        {out && (
          <Animated.View entering={FadeIn.duration(160)} style={styles.outBox} accessibilityRole="alert">
            <Text style={styles.outTitle}>{COPY.outTitle}</Text>
            <Text style={styles.outBody}>{COPY.outBody}</Text>
            <PressScale onPress={onOutOfArea} style={styles.outBtn}><Text style={styles.outBtnTxt}>{T.movePin}</Text></PressScale>
          </Animated.View>
        )}

        <Field label={COPY.name} value={f.name} placeholder={COPY.nameHint} onChange={put('name')} error={errors.name} autoComplete="name" maxLength={80} />
        <Field label={COPY.phone} value={f.phone} placeholder={COPY.phoneHint} onChange={put('phone')} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" maxLength={20} />
        <Field label={COPY.other} value={f.other} placeholder={COPY.otherHint} onChange={put('other')} error={errors.other} keyboardType="phone-pad" maxLength={20} />
        <View style={{ marginTop: 22 }}>
          <Text style={styles.label}>{T.area}</Text>
          <View style={styles.chips}>
            {(choices.includes(town) ? choices : [...choices, town]).map((a) => (
              <Pressable key={a} onPress={() => setTown(a)} accessibilityRole="button" accessibilityState={{ selected: a === town }} style={[styles.chip, a === town && styles.chipOn]}>
                <Text style={[styles.chipTxt, a === town && styles.chipTxtOn]}>{a}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Field label={COPY.line} value={f.line} placeholder={COPY.lineHint} onChange={put('line')} error={errors.line} autoComplete="street-address" maxLength={150} />
        <Field label={COPY.notes} value={f.notes} placeholder={COPY.notesHint} onChange={put('notes')} error={errors.notes} maxLength={300} />
        {!!errors.pin && <Text style={styles.fieldError}>{errors.pin}</Text>}

        <View style={styles.errorBox}>
          {!!error && <Text style={styles.fieldError} accessibilityRole="alert">{error}</Text>}
          {!signedIn && !error && <Text style={styles.helper}>{T.guestNote}</Text>}
        </View>

        <PressScale onPress={() => void submit()} disabled={busy} haptic scaleTo={0.96} style={[styles.cta, busy && { opacity: 0.7 }]}>
          <Text style={styles.ctaTxt}>{busy ? T.saving : T.save}</Text>
        </PressScale>
      </ScrollView>
    </Animated.View>
  );
}

/** Label, underlined input (dark and thicker while focused), then the error line (the registration screen's field). */
function Field({ label, value, onChange, placeholder, error, keyboardType, autoComplete, maxLength }: {
  label: string; value: string; onChange: (t: string) => void; placeholder?: string; error?: string;
  keyboardType?: KeyboardTypeOptions; autoComplete?: 'name' | 'tel' | 'street-address'; maxLength?: number;
}) {
  const [focus, setFocus] = useState(false);
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(focus ? 1 : 0, { duration: 150 }); }, [focus]);
  const lineA = useAnimatedStyle(() => ({
    height: 1 + w.value * 1.6,
    backgroundColor: interpolateColor(w.value, [0, 1], ['#DCDCE0', C.brandInk]),
  }));
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#B4B4BC"
        keyboardType={keyboardType}
        autoComplete={autoComplete}
        autoCorrect={false}
        maxLength={maxLength}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={styles.input}
        accessibilityLabel={label}
      />
      <Animated.View style={[{ alignSelf: 'stretch' }, lineA, error ? { backgroundColor: C.problem } : null]} />
      {!!error && <Text style={styles.fieldError} accessibilityRole="alert">{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 13, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#DCDCE0', backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: C.brand, borderColor: C.brand },
  chipTxt: { fontFamily: F.medium, fontSize: 13.5, color: '#55555C' },
  chipTxtOn: { fontFamily: F.semi, color: C.brandInk },
  mapLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFEBE3', paddingHorizontal: 40 },
  failTxt: { fontFamily: F.medium, fontSize: 14, color: '#55555C', textAlign: 'center', lineHeight: 19 },
  retry: { marginTop: 14, height: 38, borderRadius: 19, paddingHorizontal: 18, backgroundColor: C.brand, justifyContent: 'center' },
  retryTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
  pinWrap: { position: 'absolute', width: 280, alignItems: 'center' },
  tip: { height: 37, borderRadius: 10, backgroundColor: '#0B0B0D', flexDirection: 'row', alignItems: 'center', paddingLeft: 11, paddingRight: 10, gap: 10 },
  tipTxt: { color: '#fff', fontFamily: F.medium, fontSize: 12.5, letterSpacing: -0.1 },
  tipX: { width: 15, height: 15, borderRadius: 8, backgroundColor: '#2C2C30', alignItems: 'center', justifyContent: 'center' },
  tipArrow: {
    width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#0B0B0D',
  },
  top: { position: 'absolute', left: 17, right: 15, flexDirection: 'row', alignItems: 'center', gap: 13 },
  backBtn: {
    width: 31, height: 31, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E6E6E9',
  },
  search: {
    flex: 1, height: 36, borderRadius: 18, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingLeft: 14, paddingRight: 13, borderWidth: 1, borderColor: '#E3E3E6',
  },
  searchTxt: { flex: 1, fontFamily: F.regular, color: '#6E6E76', fontSize: 13.5 },
  attrib: {
    position: 'absolute', right: 15, fontFamily: F.regular, fontSize: 9.5, color: '#55555C',
    backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 15 },
  note: { backgroundColor: '#1B1B1F', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10 },
  noteTxt: { color: '#fff', fontFamily: F.medium, fontSize: 12.5, lineHeight: 16 },
  current: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 20, height: 39,
    paddingHorizontal: 13, marginBottom: 13, borderWidth: 1, borderColor: '#E3E3E6',
  },
  currentTxt: { fontFamily: F.medium, fontSize: 12.5, color: '#333' },
  card: {
    backgroundColor: '#fff', borderRadius: 16, paddingBottom: 15, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  cardHead: { height: 32, backgroundColor: '#F4F4F6', justifyContent: 'center', paddingHorizontal: 17 },
  cardHeadBad: { backgroundColor: '#FDECEA' },
  cardHint: { fontFamily: F.regular, fontSize: 12.5, color: '#55555C' },
  placeName: { flex: 1, fontFamily: F.semi, fontSize: 16.5, color: '#111' },
  placeLine: { fontFamily: F.regular, fontSize: 13, color: '#55555C', marginTop: 7, lineHeight: 17, paddingRight: 6 },
  cta: { height: 50, borderRadius: 25, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 16 },
  form: { backgroundColor: '#fff' },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 17, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  formTitle: { fontFamily: F.semi, fontSize: 16.7, color: C.brandInk },
  pinRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 12, borderRadius: 12,
    backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandSoft,
  },
  pinRowTitle: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
  pinRowSub: { fontFamily: F.regular, fontSize: 12, color: '#55555C', marginTop: 1 },
  change: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  outBox: { marginTop: 14, padding: 13, borderRadius: 12, backgroundColor: '#FDECEA' },
  outTitle: { fontFamily: F.semi, fontSize: 14.5, color: C.problem },
  outBody: { fontFamily: F.regular, fontSize: 12.5, color: '#55555C', marginTop: 3, lineHeight: 17 },
  outBtn: { alignSelf: 'flex-start', marginTop: 10, height: 32, borderRadius: 16, paddingHorizontal: 14, backgroundColor: C.brand, justifyContent: 'center' },
  outBtnTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.brandInk },
  label: { fontFamily: F.regular, fontSize: 11, color: '#5E5E66', lineHeight: 14 },
  input: { fontFamily: F.medium, fontSize: 15, color: '#333', paddingVertical: 8, marginTop: 4, outlineStyle: 'none' } as object,
  fieldError: { fontFamily: F.medium, fontSize: 11.6, color: C.problem, marginTop: 6, lineHeight: 15 },
  helper: { fontFamily: F.regular, fontSize: 11.3, color: '#6E6E76', lineHeight: 15 },
  errorBox: { minHeight: 40, justifyContent: 'center', paddingVertical: 8 },
});
