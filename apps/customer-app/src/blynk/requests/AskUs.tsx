import { router } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { showNotice } from '@/blynk/account/notice';
import { Card, Row, Sheet } from '@/blynk/account/ui';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { isNotReady, useFeatureOn } from '@/blynk/lib/featureGate';
import { useStore } from '@/blynk/store/StoreContext';
import { PressScale, tap } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { useKeyboardInset } from '@/lib/keyboard';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import { sendProductRequest } from './api';
import { ASK_COPY, NAME_MAX, NOTE_MAX, prefillName, requestErrorText, validateRequest } from './model';

/*
 * "Can't find it? Ask us" (migration 056): one app-wide sheet (AskUsHost in the root layout) opened
 * from the search no-results state, the end of a category's products and Account. Product name,
 * an optional note and category, then POST /product-requests (guests too) and a thank-you. Hidden
 * while GET /store `product_requests_enabled` is off or the API answered PRODUCT_REQUESTS_NOT_READY.
 */

type AskOpts = { name?: string; categoryId?: string | null };
let current: (AskOpts & { seq: number }) | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function openAskUs(opts: AskOpts = {}) { current = { ...opts, seq: ++seq }; emit(); }
export function closeAskUs() { if (current) { current = null; emit(); } }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snap = () => current;

/** Is "Ask us" offered right now (the store says on, not refused, not the design mock)? */
export function useAskUsOn(): boolean {
  const on = useFeatureOn(useStore(), 'requests');
  return !DEMO && on;
}

export function AskUsHost() {
  const open = useSyncExternalStore(subscribe, snap, snap);
  const on = useAskUsOn();
  if (!open || !on) return null;
  return <AskUsSheet key={open.seq} opts={open} />;
}

function AskUsSheet({ opts }: { opts: AskOpts }) {
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const { data } = useCatalog();
  const aisles = data?.aisles ?? [];
  // a sub-category opens with its aisle picked
  const startCat = opts.categoryId ? (data?.topOf(opts.categoryId) ?? opts.categoryId) : null;
  const [name, setName] = useState(() => prefillName(opts.name));
  const [note, setNote] = useState('');
  const [cat, setCat] = useState<string | null>(startCat && aisles.some((a) => a.id === startCat) ? startCat : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: 'name' | 'note' | 'form'; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const sending = useRef(false);
  const kb = useKeyboardInset();

  const send = async () => {
    if (sending.current) return;
    const check = validateRequest({ name, note, categoryId: cat });
    if (!check.ok) { setError({ field: check.field, text: check.error }); return; }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await sendProductRequest(check.body);
      setDone(true);
    } catch (e) {
      if (isNotReady(e, 'requests')) { closeAskUs(); showNotice("Requests aren't open yet. Please try again later."); return; }
      setError({ field: 'form', text: requestErrorText(e) });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet label={ASK_COPY.title} onClose={closeAskUs}>
      {done ? (
        <Thanks signedIn={signedIn} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 600 }} contentContainerStyle={{ paddingBottom: kb }}>
          <View style={s.headRow}>
            <Text style={{ fontSize: 26 }}>🛒</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.title} accessibilityRole="header">{ASK_COPY.title}</Text>
              <Text style={s.sub}>{ASK_COPY.sub}</Text>
            </View>
          </View>

          <Text style={s.label}>{ASK_COPY.nameLabel}</Text>
          <TextInput
            value={name}
            onChangeText={(t) => { setName(t.slice(0, NAME_MAX)); if (error?.field === 'name') setError(null); }}
            placeholder={ASK_COPY.namePlaceholder}
            placeholderTextColor="#A3A5B0"
            maxLength={NAME_MAX}
            autoFocus={!name}
            returnKeyType="next"
            accessibilityLabel={ASK_COPY.nameLabel}
            style={[s.input, error?.field === 'name' && s.inputBad, web]}
          />
          {error?.field === 'name' && <Text style={s.err} accessibilityRole="alert">{error.text}</Text>}

          <Text style={s.label}>{ASK_COPY.noteLabel}</Text>
          <TextInput
            value={note}
            onChangeText={(t) => { setNote(t.slice(0, NOTE_MAX)); if (error?.field === 'note') setError(null); }}
            placeholder={ASK_COPY.notePlaceholder}
            placeholderTextColor="#A3A5B0"
            maxLength={NOTE_MAX}
            multiline
            accessibilityLabel={ASK_COPY.noteLabel}
            style={[s.input, s.note, error?.field === 'note' && s.inputBad, web]}
          />
          {error?.field === 'note' && <Text style={s.err} accessibilityRole="alert">{error.text}</Text>}

          {aisles.length > 0 && (
            <>
              <Text style={s.label}>{ASK_COPY.categoryLabel}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }} keyboardShouldPersistTaps="handled">
                {aisles.map((a) => {
                  const on = cat === a.id;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => { tap(); setCat(on ? null : a.id); }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      style={[s.chip, on && s.chipOn]}
                    >
                      <Text style={[s.chipTxt, on && s.chipTxtOn]} numberOfLines={1}>{a.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          {error?.field === 'form' && <Text style={[s.err, { marginTop: 12 }]} accessibilityRole="alert">{error.text}</Text>}
          <PressScale onPress={() => void send()} disabled={busy} haptic scaleTo={0.97} style={[s.btn, { marginTop: 18 }, busy && { backgroundColor: C.brandSoft }]}>
            {busy ? <ActivityIndicator color={C.brandInk} /> : <Text style={s.btnTxt}>{ASK_COPY.send}</Text>}
          </PressScale>
        </ScrollView>
      )}
    </Sheet>
  );
}

const web = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** The thank-you: a parcel that drops in and bounces, a check that pops, then a soft ring. */
function Thanks({ signedIn }: { signedIn: boolean }) {
  const reduced = useReducedMotion();
  const drop = useSharedValue(reduced ? 1 : 0);
  const check = useSharedValue(reduced ? 1 : 0);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    drop.value = withSpring(1, { damping: 8, stiffness: 180 });
    check.value = withDelay(320, withSequence(withTiming(1.25, { duration: 160, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 7, stiffness: 300 })));
    ring.value = withDelay(260, withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), 2, false));
  }, []);
  const box = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - drop.value) * -60 }, { scale: 0.6 + 0.4 * drop.value }], opacity: Math.min(1, drop.value * 1.6) }));
  const tick = useAnimatedStyle(() => ({ transform: [{ scale: check.value }], opacity: Math.min(1, check.value) }));
  const halo = useAnimatedStyle(() => ({ opacity: ring.value > 0 && ring.value < 1 ? 0.5 * (1 - ring.value) : 0, transform: [{ scale: 0.8 + ring.value * 0.9 }] }));
  return (
    <View style={{ alignItems: 'center', paddingTop: 6 }} accessibilityLiveRegion="polite">
      <View style={s.art}>
        <Animated.View style={[s.halo, halo]} />
        <Animated.Text style={[{ fontSize: 54 }, box]}>📦</Animated.Text>
        <Animated.View style={[s.tick, tick]}><Text style={s.tickTxt}>✓</Text></Animated.View>
      </View>
      <Animated.Text entering={FadeInDown.delay(200).duration(260)} style={[s.title, { textAlign: 'center', marginTop: 12 }]}>{ASK_COPY.thanksTitle}</Animated.Text>
      <Animated.Text entering={FadeInDown.delay(280).duration(260)} style={[s.sub, { textAlign: 'center', marginTop: 4, paddingHorizontal: 12 }]}>
        {signedIn ? ASK_COPY.thanksSignedIn : ASK_COPY.thanksGuest}
      </Animated.Text>
      <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 20 }}>
        {signedIn && (
          <PressScale onPress={() => { closeAskUs(); router.push('/requests' as never); }} scaleTo={0.97} style={[s.btn, s.btnQuiet, { flex: 1 }]}>
            <Text style={s.btnTxt}>{ASK_COPY.myRequests}</Text>
          </PressScale>
        )}
        <PressScale onPress={closeAskUs} haptic scaleTo={0.97} style={[s.btn, { flex: 1 }]}>
          <Text style={s.btnTxt}>{ASK_COPY.done}</Text>
        </PressScale>
      </View>
    </View>
  );
}

/**
 * The inline "Can't find what you need? Ask us" card: under search's no-results message and at the
 * end of a category's products. `name` prefills the product name; `categoryId` the category.
 */
export function AskUsPrompt({ name, categoryId, style }: { name?: string; categoryId?: string | null; style?: StyleProp<ViewStyle> }) {
  const on = useAskUsOn();
  if (!on) return null;
  return (
    <Animated.View entering={FadeIn.duration(240)} style={[s.inline, style]}>
      <Text style={{ fontSize: 22 }}>🙋</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.inlineTitle}>{ASK_COPY.inline}</Text>
        <Text style={s.inlineSub}>{ASK_COPY.inlineSub}</Text>
      </View>
      <PressScale onPress={() => openAskUs({ name, categoryId })} haptic scaleTo={0.94} style={s.inlineBtn} accessibilityRole="button" accessibilityLabel={ASK_COPY.title}>
        <Text style={s.inlineBtnTxt}>{ASK_COPY.cta}</Text>
      </PressScale>
    </Animated.View>
  );
}

/** Account: "Can't find something? Ask us" and (signed in) "My requests". */
export function ProductRequestsCard({ stagger }: { stagger?: number }) {
  const on = useAskUsOn();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  if (!on) return null;
  return (
    <Card tone={C.greenTint} stagger={stagger}>
      <Row icon="🙋" title="Can't find something? Ask us" sub={ASK_COPY.rowSub} onPress={() => openAskUs()} last={!signedIn} />
      {signedIn && <Row icon="📝" title={ASK_COPY.myRequests} sub={ASK_COPY.myRowSub} onPress={() => router.push('/requests' as never)} last />}
    </Card>
  );
}

const s = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  title: { fontFamily: F.bold, fontSize: 18, color: C.ink, letterSpacing: -0.2 },
  sub: { fontFamily: F.regular, fontSize: 13, color: C.sub, lineHeight: 18, marginTop: 2 },
  label: { fontFamily: F.semi, fontSize: 12.5, color: C.sub, marginTop: 14, marginBottom: 6 },
  input: {
    minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff',
    paddingHorizontal: 13, paddingVertical: 11, fontFamily: F.medium, fontSize: 15, color: C.ink,
  },
  note: { minHeight: 70, textAlignVertical: 'top', fontFamily: F.regular, fontSize: 14 },
  inputBad: { borderColor: C.problem },
  err: { fontFamily: F.medium, fontSize: 12.5, color: C.problem, marginTop: 6 },
  chip: { height: 34, borderRadius: 17, paddingHorizontal: 13, borderWidth: 1, borderColor: '#DCDCE2', backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: C.brandTint, borderColor: C.brandDeep, borderWidth: 1.4 },
  chipTxt: { fontFamily: F.medium, fontSize: 13, color: '#4A4A52', maxWidth: 180 },
  chipTxtOn: { fontFamily: F.semi, color: C.brandInk },
  btn: { height: 48, borderRadius: 24, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  btnQuiet: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  btnTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  art: { width: 110, height: 96, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: C.brand },
  tick: { position: 'absolute', right: 14, bottom: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  tickTxt: { color: '#fff', fontFamily: F.bold, fontSize: 15, marginTop: -1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.brandTint, borderRadius: 16, borderWidth: 1, borderColor: C.brandSoft, padding: 14 },
  inlineTitle: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  inlineSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2, lineHeight: 16 },
  inlineBtn: { height: 36, borderRadius: 18, paddingHorizontal: 16, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.brandDeep },
  inlineBtnTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
});
