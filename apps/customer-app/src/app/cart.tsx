import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOut, FadeOutLeft, interpolate, interpolateColor, LinearTransition,
  useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
  ZoomIn, ZoomOut,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { FeeHeader } from '@/components/FeeHeader';
import { BackIcon, ChevronIcon, CloseIcon, NavIcon, VegMark } from '@/components/icons';
import {
  AddButton, Chevron, Collapsible, PressScale, RollingText, Skeleton, StampBadge, tap, Tooltip,
} from '@/components/ui';
import { useCart } from '@/lib/cart';
import { PRODUCTS, STORES } from '@/lib/data';
import { C, F } from '@/lib/theme';

const BACK_ROW = 44;

export default function Cart() {
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { qty, total, mrpTotal, freeDelivery, phone, address, storeId } = cart;
  const store = STORES.find((s) => s.id === storeId) ?? STORES[0];
  const [loading, setLoading] = useState(true);
  const [hurray, setHurray] = useState(false);
  const [login, setLogin] = useState(false);
  const [bag, setBag] = useState(false);
  const [tip, setTip] = useState(true);
  const [basket, setBasket] = useState(false);
  const [instr, setInstr] = useState(false);
  const [bill, setBill] = useState(true);
  const y = useSharedValue(0);

  useEffect(() => {
    const a = setTimeout(() => setLoading(false), 750);
    const b = setTimeout(() => freeDelivery && setHurray(true), 1000);
    const c = setTimeout(() => setBasket(true), 1900);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, []);

  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });

  const delivery = freeDelivery ? 0 : 25;
  const taxes = Math.round(total * 0.05 * 100) / 100;
  const toPay = Math.round(total + delivery + taxes);
  const saved = Math.round(mrpTotal - total + (freeDelivery ? 25 : 0));
  const items = Object.keys(qty);

  if (items.length === 0 && !loading) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top }]}>
        <Animated.Text entering={ZoomIn.springify().mass(1).energyThreshold(1e-4)} style={{ fontSize: 80 }}>🧺</Animated.Text>
        <Animated.Text entering={FadeInDown.delay(120)} style={styles.emptyTitle}>Your basket is empty</Animated.Text>
        <PressScale onPress={() => router.replace('/home')} style={[styles.cta, { paddingHorizontal: 30, marginTop: 20 }]}>
          <Text style={styles.ctaTxt}>Browse stores</Text>
        </PressScale>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.backRow, { paddingTop: insets.top, height: insets.top + BACK_ROW }]}>
        <PressScale onPress={() => router.back()} style={{ padding: 6 }}><BackIcon size={20} /></PressScale>
        <Text style={styles.backTitle}>{store.name}</Text>
      </View>

      {loading ? (
        <CartSkeleton top={insets.top + BACK_ROW} />
      ) : (
        <Animated.ScrollView
          entering={FadeIn.duration(300)}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 54, paddingBottom: 190, paddingHorizontal: 12 }}
        >
          {/* items */}
          <Animated.View layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)} style={styles.card}>
            {items.map((id) => {
              const p = PRODUCTS[id];
              return (
                <Animated.View key={id} exiting={FadeOutLeft.duration(220)} layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)} style={styles.itemRow}>
                  <VegMark color={p.organic ? C.green : '#C0392B'} size={11} />
                  <Text style={styles.itemName} numberOfLines={1}>{p.emoji} {p.name}</Text>
                  <AddButton id={id} compact />
                  <View style={{ width: 46, alignItems: 'flex-end' }}>
                    {p.mrp > p.price && <Text style={styles.strike}>₹{p.mrp * qty[id]}</Text>}
                    <RollingText text={`₹${p.price * qty[id]}`} numeric={qty[id]} style={styles.itemPrice} />
                  </View>
                </Animated.View>
              );
            })}
            <View style={styles.actions}>
              <PressScale onPress={() => router.back()} style={styles.action}><Text style={styles.actionTxt}>＋ Add Items</Text></PressScale>
              <PressScale style={styles.action}><Text style={styles.actionTxt}>✎ Notes</Text></PressScale>
              <PressScale onPress={() => { setBag((b) => !b); setTip(false); }} style={styles.action} haptic>
                <CheckBox on={bag} />
                <Text style={styles.actionTxt}>Carry bag</Text>
              </PressScale>
            </View>
            {tip && (
              <Animated.View exiting={ZoomOut.duration(150)} style={{ alignItems: 'flex-end', marginTop: -2, marginRight: 4 }}>
                <Tooltip arrow="up" text="Tap here if you need a carry bag" onClose={() => setTip(false)} />
              </Animated.View>
            )}

            <Collapsible open={basket}>
              <CompleteBasket storeId={store.id} />
            </Collapsible>
          </Animated.View>

          {/* savings */}
          <Animated.View layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)} style={styles.card}>
            <Row icon="%" label="Payment offers & more" right={<View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} /></View>} />
            <Row icon="₹" label={`₹${Math.max(0, Math.round(mrpTotal - total))} saved with 'Items at ₹${store.itemsAt}'`} right={<Applied delay={200} />} />
            {freeDelivery && <Row icon="🛵" label="₹25 saved with free delivery" right={<Applied delay={350} />} />}
          </Animated.View>

          {/* instructions */}
          <Animated.View layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)} style={styles.card}>
            <Pressable onPress={() => setInstr((v) => !v)}>
              <Row icon="✎" label="Add Delivery Instructions" right={<Chevron open={instr} />} />
            </Pressable>
            <Collapsible open={instr}>
              <InstructionChips />
            </Collapsible>
          </Animated.View>

          {/* bill */}
          <Animated.View layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)} style={styles.card}>
            <StampBadge size={54} style={{ position: 'absolute', right: 10, top: -4 }} />
            <Pressable onPress={() => setBill((b) => !b)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <View style={styles.rowIcon}><Text style={styles.rowIconTxt}>₹</Text></View>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.rowLabel}>To Pay</Text>
                  <Text style={styles.strike}>₹{Math.round(mrpTotal + 25 + taxes)}</Text>
                  <RollingText text={`₹${toPay}`} numeric={toPay} style={styles.rowLabel} />
                </View>
                <Text style={styles.savedTxt}>₹{saved} saved on the total!</Text>
              </View>
            </Pressable>
            <Collapsible open={bill}>
              <View style={{ paddingTop: 14, gap: 10 }}>
                <BillLine l="Item Total" r={<Text><Text style={styles.strike}>₹{mrpTotal} </Text><Text style={styles.billR}>₹{total}</Text></Text>} />
                <BillLine l="Delivery Fee | 4.8 kms" dashed r={freeDelivery ? <Text><Text style={styles.strike}>₹25.00 </Text><Text style={[styles.billR, { color: C.green }]}>FREE</Text></Text> : <Text style={styles.billR}>₹25</Text>} />
                {freeDelivery && <Text style={styles.freeNote}>FREE Delivery on your order!</Text>}
                <BillLine l="Government Taxes" dashed r={<Text style={styles.billR}>₹{taxes.toFixed(2)}</Text>} />
                <View style={styles.thatsIt}><Text style={styles.thatsItTxt}>THAT&apos;S IT. No unnecessary fees. Ever!</Text></View>
                <BillLine l="To Pay" r={<Text style={[styles.billR, { fontFamily: F.bold }]}>₹{toPay}</Text>} />
              </View>
            </Collapsible>
          </Animated.View>

          <Text style={styles.policy}>
            Cancellation policy:{'\n'}Please double-check your order and address details. Orders are non-refundable once placed.
          </Text>
        </Animated.ScrollView>
      )}

      {!loading && <FeeHeader scrollY={y} topInset={insets.top} backRowH={BACK_ROW + 4} />}

      {/* bottom action panel — swaps through login → address → place order */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {!phone ? (
          <Animated.View key="login" entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)}>
            <Text style={styles.bottomTitle}>Almost There</Text>
            <Text style={styles.bottomSub}>Login/Create Account quickly to place order</Text>
            <GlowButton label="Proceed with Phone Number" onPress={() => setLogin(true)} />
          </Animated.View>
        ) : !address ? (
          <Animated.View key="addr" entering={FadeInDown.duration(300)} exiting={FadeOut.duration(150)}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <NavIcon size={16} color={C.green} />
              <Text style={[styles.bottomTitle, { flex: 1 }]}>Where would you like us to deliver this order?</Text>
            </View>
            <GlowButton label="Add or Select address" onPress={() => router.push('/address')} />
          </Animated.View>
        ) : (
          <Animated.View key="place" entering={FadeInDown.duration(300)}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ fontSize: 16 }}>🏠</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.bottomTitle}>Delivering to {address.title}</Text>
                <Text style={styles.bottomSub} numberOfLines={1}>{address.line}</Text>
              </View>
              <Pressable onPress={() => router.push('/address')}><Text style={styles.change}>Change</Text></Pressable>
            </View>
            <GlowButton label={`Place Order  |  ₹${toPay}`} onPress={() => router.replace('/placed')} />
          </Animated.View>
        )}
      </View>

      {hurray && <HurrayModal onClose={() => setHurray(false)} />}
      {login && <LoginSheet onClose={() => setLogin(false)} />}
    </View>
  );
}

/* ------------------------------------------------------------------ */

/** CTA that arrives pale and "charges up" to full green, like the original. */
function GlowButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const g = useSharedValue(0);
  useEffect(() => {
    g.value = withDelay(150, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }));
  }, [label]);
  const a = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(g.value, [0, 1], [C.greenSoft, C.green]) }));
  return (
    <PressScale onPress={onPress} disabled={disabled} haptic style={{ marginTop: 12 }}>
      <Animated.View style={[styles.cta, a]}>
        <Text style={styles.ctaTxt}>{label}</Text>
      </Animated.View>
    </PressScale>
  );
}

function CheckBox({ on }: { on: boolean }) {
  const s = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    s.value = withSpring(on ? 1 : 0, { damping: 10, stiffness: 260 });
  }, [on]);
  const a = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: s.value }] }));
  return (
    <View style={[styles.checkBox, on && { borderColor: C.green }]}>
      <Animated.View style={[styles.checkFill, a]}><Text style={{ color: '#fff', fontSize: 9, fontFamily: F.black }}>✓</Text></Animated.View>
    </View>
  );
}

function Applied({ delay }: { delay: number }) {
  return (
    <Animated.Text entering={ZoomIn.delay(delay).springify().mass(1).energyThreshold(1e-4).damping(9)} style={styles.applied}>✓ Applied</Animated.Text>
  );
}

function Row({ icon, label, right }: { icon: string; label: string; right?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Text style={styles.rowIconTxt}>{icon}</Text></View>
      <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={1}>{label}</Text>
      {right}
    </View>
  );
}

function BillLine({ l, r, dashed }: { l: string; r: React.ReactNode; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[styles.billL, dashed && { textDecorationLine: 'underline', textDecorationStyle: 'dashed' }]}>{l}</Text>
      {r}
    </View>
  );
}

function InstructionChips() {
  const opts = ['🚪 Leave at door', '🔕 Avoid calling', '🔔 Don\'t ring bell', '🐶 Pet at home'];
  const [on, setOn] = useState<string[]>([]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 12 }}>
      {opts.map((o) => {
        const a = on.includes(o);
        return (
          <PressScale key={o} haptic onPress={() => setOn((s) => (a ? s.filter((x) => x !== o) : [...s, o]))}
            style={[styles.instr, a && { borderColor: C.green, backgroundColor: C.greenTint }]}>
            <Text style={[styles.instrTxt, a && { color: C.greenDark }]}>{o}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

function CompleteBasket({ storeId }: { storeId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 650);
    return () => clearTimeout(t);
  }, []);
  const ids = (STORES.find((s) => s.id === storeId)?.products ?? []).slice(5, 9);
  return (
    <View style={{ paddingTop: 14 }}>
      <Text style={styles.basketTitle}>C O M P L E T E   Y O U R   B A S K E T</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
        {ids.map((id, i) => {
          const p = PRODUCTS[id];
          return (
            <View key={id} style={{ width: 66 }}>
              {ready ? (
                <Animated.View entering={ZoomIn.delay(i * 70).springify().mass(1).energyThreshold(1e-4).damping(12)} style={[styles.basketImg, { backgroundColor: p.bg }]}>
                  <Text style={{ fontSize: 30 }}>{p.emoji}</Text>
                  <View style={{ position: 'absolute', top: -6, right: -6 }}>
                    <AddButton id={id} storeId={storeId} compact />
                  </View>
                </Animated.View>
              ) : (
                <Skeleton w={66} h={66} r={10} />
              )}
              <Text style={styles.basketName} numberOfLines={2}>{p.name}</Text>
              <Text style={styles.basketPrice}>₹{p.price}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** "Hurray! Free delivery unlocked" — springs in, mascot bounces, auto-dismiss bar drains. */
function HurrayModal({ onClose }: { onClose: () => void }) {
  const drain = useSharedValue(1);
  const bounce = useSharedValue(0);
  const close = () => { tap(); onClose(); };
  useEffect(() => {
    drain.value = withTiming(0, { duration: 3800, easing: Easing.linear }, (done) => {
      if (done) scheduleOnRN(onClose);
    });
    bounce.value = withDelay(250, withSequence(withTiming(-16, { duration: 200 }), withSpring(0, { damping: 5, stiffness: 260 })));
  }, []);
  const bar = useAnimatedStyle(() => ({ width: `${drain.value * 100}%` }));
  const m = useAnimatedStyle(() => ({ transform: [{ translateY: bounce.value }, { rotate: `${bounce.value * -1}deg` }] }));
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      <Animated.View entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(13).stiffness(180)} exiting={ZoomOut.duration(180)} style={styles.modal}>
        <Pressable onPress={close} style={styles.modalX}><CloseIcon size={9} color={C.sub} /></Pressable>
        <View style={styles.mascotCircle}>
          <Animated.Text style={[{ fontSize: 64 }, m]}>🛵</Animated.Text>
        </View>
        <Text style={styles.modalTitle}>Hurray! Free delivery{'\n'}Unlocked!</Text>
        <Text style={styles.modalSub}>Applied directly on bill, above ₹149</Text>
        <PressScale onPress={close} style={[styles.cta, { alignSelf: 'stretch', marginTop: 16 }]} haptic>
          <Text style={styles.ctaTxt}>YAY!</Text>
        </PressScale>
        <View style={styles.drainTrack}><Animated.View style={[styles.drain, bar]} /></View>
      </Animated.View>
    </Animated.View>
  );
}

/** Login bottom sheet with floating label and a Continue button that lights up at 10 digits. */
function LoginSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [num, setNum] = useState('');
  const ready = num.length === 10;
  const lift = useSharedValue(0);
  const en = useSharedValue(0);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    lift.value = withTiming(num.length > 0 ? 1 : 0, { duration: 180 });
    en.value = withTiming(ready ? 1 : 0, { duration: 250 });
  }, [num]);
  const label = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(lift.value, [0, 1], [0, -18]) }, { scale: interpolate(lift.value, [0, 1], [1, 0.75]) }],
  }));
  const btn = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(en.value, [0, 1], [C.greenSoft, C.green]) }));
  const submit = () => {
    Keyboard.dismiss();
    onClose();
    router.push({ pathname: '/otp', params: { phone: num } });
  };
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        entering={FadeInDown.springify().mass(1).energyThreshold(1e-4).damping(17).stiffness(150)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}
      >
        <Text style={styles.sheetTitle}>Login</Text>
        <Text style={styles.bottomSub}>Enter your phone number to proceed</Text>
        <Pressable onPress={() => input.current?.focus()} style={styles.phoneRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.cc}>🇮🇳  +91</Text>
            <ChevronIcon size={14} color={C.sub} />
          </View>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Animated.Text style={[styles.floatLabel, label]}>Mobile Number</Animated.Text>
            <TextInput
              ref={input}
              autoFocus
              value={num}
              onChangeText={(t) => setNum(t.replace(/\D/g, '').slice(0, 10))}
              keyboardType="number-pad"
              style={styles.phoneInput}
              maxLength={10}
            />
          </View>
        </Pressable>
        <PressScale disabled={!ready} onPress={submit} haptic>
          <Animated.View style={[styles.cta, btn]}><Text style={styles.ctaTxt}>Continue</Text></Animated.View>
        </PressScale>
        <Text style={styles.terms}>
          By clicking, I accept the <Text style={styles.link}>privacy policy</Text> and <Text style={styles.link}>terms of use</Text>
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

function CartSkeleton({ top }: { top: number }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 16, gap: 14 }}>
      <Skeleton h={40} r={12} />
      {[90, 70, 70, 120].map((h, i) => (
        <View key={i} style={[styles.card, { gap: 10 }]}>
          <Skeleton w="60%" h={10} />
          <Skeleton w="40%" h={10} />
          {h > 80 && <Skeleton w="80%" h={10} />}
        </View>
      ))}
      <View style={{ height: top }} />
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6, backgroundColor: C.bg, zIndex: 5 },
  backTitle: { fontFamily: F.medium, color: C.sub, fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  itemName: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.ink },
  strike: { fontFamily: F.regular, fontSize: 10.5, color: C.faint, textDecorationLine: 'line-through' },
  itemPrice: { fontFamily: F.semi, fontSize: 12.5, color: C.ink },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  actionTxt: { fontFamily: F.medium, fontSize: 11.5, color: C.text },
  checkBox: { width: 15, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: C.faint, overflow: 'hidden' },
  checkFill: { flex: 1, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  rowIconTxt: { color: '#fff', fontSize: 11, fontFamily: F.bold },
  rowLabel: { fontFamily: F.medium, fontSize: 13, color: C.ink },
  applied: { fontFamily: F.semi, color: C.green, fontSize: 12 },
  savedTxt: { fontFamily: F.medium, color: C.green, fontSize: 11.5, marginTop: 2 },
  billL: { fontFamily: F.regular, fontSize: 12.5, color: C.sub },
  billR: { fontFamily: F.medium, fontSize: 12.5, color: C.ink },
  freeNote: { fontFamily: F.regular, fontSize: 11, color: C.faint, marginTop: -6 },
  thatsIt: { backgroundColor: C.pinkTint, borderRadius: 6, padding: 7 },
  thatsItTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.pink },
  policy: { fontFamily: F.regular, fontSize: 11, color: C.faint, marginHorizontal: 6, marginTop: 4, lineHeight: 16 },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 14,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, elevation: 10,
  },
  bottomTitle: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  bottomSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2 },
  change: { fontFamily: F.bold, color: C.pink, fontSize: 13 },
  cta: { height: 50, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: '#fff', fontFamily: F.bold, fontSize: 15 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20,20,30,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 50 },
  modal: { width: 280, backgroundColor: '#fff', borderRadius: 18, padding: 18, alignItems: 'center', overflow: 'hidden' },
  modalX: { position: 'absolute', right: 10, top: 10, width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  mascotCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#D9F7E1', alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontFamily: F.bold, fontSize: 19, color: C.ink, textAlign: 'center', marginTop: 12, lineHeight: 23 },
  modalSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 4 },
  drainTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
  drain: { height: 4, backgroundColor: C.green, alignSelf: 'center' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  sheetTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1.5, borderBottomColor: C.line, marginVertical: 18, height: 54 },
  cc: { fontFamily: F.medium, fontSize: 14, color: C.ink },
  floatLabel: { position: 'absolute', left: 0, fontFamily: F.regular, color: C.faint, fontSize: 15, transformOrigin: 'left' },
  phoneInput: { fontFamily: F.medium, fontSize: 16, color: C.ink, paddingTop: 12, letterSpacing: 1 },
  terms: { fontFamily: F.regular, fontSize: 11.5, color: C.sub, textAlign: 'center', marginTop: 12 },
  link: { textDecorationLine: 'underline', color: C.ink },
  instr: { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  instrTxt: { fontFamily: F.medium, fontSize: 12, color: C.text },
  basketTitle: { fontFamily: F.semi, fontSize: 10, color: C.sub },
  basketImg: { width: 66, height: 66, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  basketName: { fontFamily: F.medium, fontSize: 10.5, color: C.ink, marginTop: 5 },
  basketPrice: { fontFamily: F.semi, fontSize: 10.5, color: C.ink },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  emptyTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, marginTop: 12 },
});
