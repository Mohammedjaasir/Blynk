import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, interpolate, interpolateColor, LinearTransition, useAnimatedStyle, useSharedValue,
  withTiming, ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive } from '@/blynk/lib/pricing';
import { useStore } from '@/blynk/store/StoreContext';
import { ClosedBanner, useStoreClosed } from '@/components/ClosedBanner';
import { FEE, FeeHeader } from '@/components/FeeHeader';
import { BackIcon, ChevronIcon, CloseIcon, NavIcon, VegMark } from '@/components/icons';
import { ProductImage } from '@/components/ProductImage';
import { Collapsible, PressScale, Skeleton, StampBadge, tap } from '@/components/ui';
import { BILL, COPY, MEAL_PICKS, rupee } from '@/demo/cart';
import { LIVE, liveBill, liveOfferRows, type LiveBill } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { withSpring } from '@/lib/motion';
import { cartActions, useCart, useCartSelect } from '@/lib/cart';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * Cart, read frame by frame off the reference (video 0:41–1:20). All copy and fees are the
 * video's mock content (src/demo/cart.ts); the item lines come from the cart store.
 * Login, OTP and address stay local previews: nothing is sent, nothing is ordered.
 *
 * Live mode (DEMO=false) keeps the layout and motion but every value is Blynk's own: lines and
 * totals from the cart store at effective (offer-aware) LKR prices, unavailable lines flagged,
 * the delivery fee / free deliveries / offer-savings switch / open-closed state from GET /store
 * (Admin and Ops control all of these). Taxes, distances and the video's savings are never shown;
 * offer rows appear only when true. A closed store blocks "Place order".
 */

/** Demo rupees, or LKR at Blynk's prices. */
const money = (n: number) => (DEMO ? rupee(n) : formatLkr(n));
const round2 = (n: number) => Math.round(n * 100) / 100;

const INK = '#222';
const TEXT = '#333';
const GREY = '#5E5E66';
const LINE = '#EFEFF2';
const SKELETON_MS = 1650;
const BURST_AFTER_MODAL = 800;
const VEIL_MS = 2600;
/** Skeleton bar grey sampled from the video (a touch darker than the shared token). */
const SK = '#E3E3E8';

export default function Cart() {
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { lines, total, mrpTotal, count, phone, address } = cart;
  const store = useStore();
  const { data: catalog, refresh } = useCatalog();
  const closedNow = useStoreClosed() && !DEMO;
  const live = liveBill(store, total, mrpTotal, count);
  const offerRows = DEMO ? [] : liveOfferRows(live);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hurray, setHurray] = useState(false);
  const [burst, setBurst] = useState(0);
  const [login, setLogin] = useState(false);
  const [cutlery, setCutlery] = useState(false);
  const [tip, setTip] = useState(true);
  const [instr, setInstr] = useState(false);
  const [veil, setVeil] = useState(false);
  const [notice, setNotice] = useState(0);
  const prevPhone = useRef(phone);

  useEffect(() => {
    const a = setTimeout(() => setLoading(false), SKELETON_MS);
    if (DEMO) {
      const b = setTimeout(() => lines.length && setHurray(true), SKELETON_MS + 60);
      return () => { clearTimeout(a); clearTimeout(b); };
    }
    // live: fresh prices and availability for what is in the cart (the catalogue reconciles the cart)
    if (lines.length) void refresh().then((ok) => setRefreshFailed(!ok));
    return () => clearTimeout(a);
  }, []);

  // live: the "Hurray" modal is Admin's new-customer free deliveries; without them the fee
  // header still bursts once the cart has shown (there is no modal to wait for)
  const liveFree = live.freeCount > 0;
  const storeSeen = !!store;
  useEffect(() => {
    if (DEMO || loading || !storeSeen || !lines.length) return;
    const t = liveFree ? setTimeout(() => setHurray(true), 60) : setTimeout(() => setBurst(Date.now()), BURST_AFTER_MODAL);
    return () => clearTimeout(t);
  }, [loading, storeSeen]);

  // back from OTP: the screen sits under a pale veil while it "reloads", then the
  // logged-in cart (meal picks, distance, "THAT'S IT" band, address CTA) shows
  useEffect(() => {
    if (!prevPhone.current && phone) {
      setVeil(true);
      const t = setTimeout(() => setVeil(false), VEIL_MS);
      prevPhone.current = phone;
      return () => clearTimeout(t);
    }
    prevPhone.current = phone;
  }, [phone]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(0), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  const closeHurray = () => {
    setHurray(false);
    setTimeout(() => setBurst(Date.now()), BURST_AFTER_MODAL);
  };

  const after = !!phone && !veil;
  const bill = after ? BILL.after : BILL.before;
  const toPay = DEMO ? Math.round(total + BILL.taxes) : live.toPay;
  const bottomPad = Math.max(insets.bottom + 16, 42);

  if (lines.length === 0 && !loading) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top }]}>
        <Animated.Text entering={ZoomIn.springify().mass(1).energyThreshold(1e-4)} style={{ fontSize: 80 }}>🧺</Animated.Text>
        <Text style={styles.emptyTitle}>Your cart is empty</Text>
        <PressScale onPress={() => router.replace('/home')} style={[styles.cta, { paddingHorizontal: 30, marginTop: 20 }]}>
          <Text style={styles.ctaTxt}>Browse</Text>
        </PressScale>
      </View>
    );
  }

  if (loading) return <CartSkeleton top={insets.top} bottomPad={bottomPad} />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <Animated.ScrollView
        entering={FadeIn.duration(100)}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + FEE.contentTop, paddingBottom: 200 + bottomPad }}
      >
        {!DEMO && <ClosedBanner style={{ marginHorizontal: 15, marginBottom: 15 }} />}
        {!DEMO && refreshFailed && <Text style={styles.warn}>{LIVE.refreshFailed}</Text>}

        {/* items */}
        <View style={{ zIndex: 3 }}>
          <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, styles.itemsCard]}>
            {lines.map(({ product: p, quantity }) => (DEMO ? (
              <Animated.View key={p.id} exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={styles.itemRow}>
                <VegMark size={11} color={C.veg} />
                <Text style={styles.itemName} numberOfLines={1}>{p.name}</Text>
                <Stepper product={p} qty={quantity} />
                <View style={styles.priceCol}>
                  {isOfferActive(p) && <Text style={styles.itemStrike}>{rupee(p.selling_price * quantity)}</Text>}
                  <Text style={styles.itemPrice}>{rupee((isOfferActive(p) ? p.offer_price! : p.selling_price) * quantity)}</Text>
                </View>
              </Animated.View>
            ) : (
              <LiveLine key={p.id} product={p} qty={quantity} showSavings={store?.show_offer_savings === true} />
            )))}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ marginTop: 9 }}>
              <PressScale onPress={goBack} style={styles.chip}>
                <PlusGlyph />
                <Text style={styles.chipTxt}>{COPY.chips.add}</Text>
              </PressScale>
              {DEMO && (
                <PressScale style={styles.chip}>
                  <PenGlyph />
                  <Text style={styles.chipTxt}>{COPY.chips.cooking}</Text>
                </PressScale>
              )}
              {DEMO && (
                <PressScale haptic onPress={() => { setCutlery((v) => !v); setTip(false); }} style={styles.chip}>
                  <CheckBox on={cutlery} />
                  <Text style={styles.chipTxt}>{COPY.chips.cutlery}</Text>
                </PressScale>
              )}
            </ScrollView>
          </Animated.View>
          {DEMO && tip && (
            <Animated.View exiting={FadeOut.duration(150)} style={styles.tipWrap} pointerEvents="box-none">
              <CutleryTip onClose={() => setTip(false)} />
            </Animated.View>
          )}
        </View>

        {/* complete your meal (logged-in cart) */}
        <Collapsible open={after}>
          {DEMO ? <MealCard ready={after} /> : <LiveBasket ready={after} products={catalog?.products ?? []} inCart={lines.map((l) => l.product)} />}
        </Collapsible>

        {/* offers (live: only rows that are true right now; none hides the card) */}
        {DEMO ? (
          <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0 }]}>
            <Row icon={<TagGlyph />} label={COPY.paymentOffers} right={<ChevronIcon size={16} color={INK} stroke={2.2} />} rotate />
            <View style={styles.sep} />
            <Row icon={<TagGlyph />} label={COPY.itemsAtSaving} right={<Text style={styles.applied}>{COPY.applied}</Text>} />
            <View style={styles.sep} />
            <Row icon={<BagGlyph />} label={COPY.freeDeliverySaving} right={<Text style={styles.applied}>{COPY.applied}</Text>} />
          </Animated.View>
        ) : offerRows.length > 0 && (
          <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0 }]}>
            {offerRows.map((o, i) => (
              <View key={o.key}>
                {i > 0 && <View style={styles.sep} />}
                <Row icon={o.kind === 'bag' ? <BagGlyph /> : <TagGlyph />} label={o.label} right={<Text style={styles.applied}>{o.right}</Text>} />
              </View>
            ))}
          </Animated.View>
        )}

        {/* instructions */}
        <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0 }]}>
          <Pressable onPress={() => setInstr((v) => !v)}>
            <Row icon={<PenGlyph white />} label={COPY.instructions} right={<ChevronIcon size={16} color={INK} stroke={2.2} />} h={48} />
          </Pressable>
          <Collapsible open={instr}>
            <InstructionChips />
          </Collapsible>
        </Animated.View>

        {/* bill */}
        {!DEMO ? <LiveBillCard bill={live} itemTotal={total} mrpTotal={mrpTotal} /> : (
        <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0, overflow: 'hidden' }]}>
          <StampBadge size={78} style={{ position: 'absolute', right: -6, top: -4 }} />
          <View style={styles.billHead}>
            <View style={styles.sq}><ReceiptGlyph /></View>
            <View>
              <Text style={styles.payLine}>
                To Pay <Text style={styles.payStrike}>{rupee(toPay + bill.saved)}</Text> {rupee(toPay)}
              </Text>
              <Text style={styles.savedTxt}>{rupee(bill.saved)} saved on the total!</Text>
            </View>
          </View>
          <View style={[styles.sep, { marginHorizontal: 0 }]} />
          <View style={{ paddingHorizontal: 15, paddingTop: 12 }}>
            <BillRow l="Item Total" r={<Text style={styles.billR}><Text style={styles.billStrike}>{rupee(mrpTotal)}</Text> <Text style={{ color: C.brandText }}>{rupee(total)}</Text></Text>} />
            {after && <Dashed style={{ marginVertical: 11 }} />}
            <BillRow dashed l={bill.distance} r={<Text style={styles.billR}><Text style={styles.billStrike}>{rupee(BILL.deliveryFee, bill.feeFixed)}</Text> <Text style={{ color: C.brandText }}>FREE</Text></Text>} />
            <Text style={styles.freeNote}>{BILL.freeNote}</Text>
            {!after && <Dashed style={{ marginVertical: 11 }} />}
            <View style={{ height: 2 }} />
            <BillRow dashed l="Government Taxes" r={<Text style={styles.billR}>{rupee(BILL.taxes)}</Text>} />
            {!after && <Dashed style={{ marginTop: 11 }} />}
          </View>
          {after && (
            <Animated.View entering={FadeIn.duration(250)} style={styles.thatsIt}>
              <LinearGradient colors={[C.brandTint, 'rgba(255,248,214,0)']} start={{ x: 0.55, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
              <Text style={styles.thatsItTxt}>{COPY.thatsIt}</Text>
            </Animated.View>
          )}
          <View style={[styles.billRow, { paddingHorizontal: 15, height: after ? 46 : 55 }]}>
            <Text style={styles.payTotal}>To Pay</Text>
            <Text style={styles.payTotal}>{rupee(toPay)}</Text>
          </View>
        </Animated.View>
        )}

        <Text style={styles.policyTitle}>{COPY.policyTitle}</Text>
        <Text style={styles.policy}>{DEMO ? COPY.policy : LIVE.policy}</Text>
      </Animated.ScrollView>

      <FeeHeader
        topInset={insets.top}
        burstKey={burst}
        backRow={(
          <View style={styles.backRow}>
            <PressScale onPress={goBack} style={{ padding: 2 }}><BackIcon size={20} color={TEXT} stroke={1.8} /></PressScale>
            <Text style={styles.backTitle} numberOfLines={1}>{DEMO ? COPY.storeName : LIVE.storeTitle(store)}</Text>
          </View>
        )}
      />

      {/* bottom action panel: login → address → (local) place order */}
      <View style={[styles.bottom, { paddingBottom: bottomPad }]}>
        {!phone ? (
          <Animated.View key="login" exiting={FadeOut.duration(150)}>
            <Text style={styles.bottomTitle}>{COPY.almost}</Text>
            <Text style={styles.bottomSub}>{COPY.almostSub}</Text>
            <PressScale onPress={() => setLogin(true)} haptic style={{ marginTop: 24 }} scaleTo={0.95}>
              <View style={styles.cta}><Text style={styles.ctaTxt}>{COPY.proceedPhone}</Text></View>
            </PressScale>
          </Animated.View>
        ) : !address ? (
          <Animated.View key="addr" entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <View style={styles.whereRow}>
              <View style={{ marginTop: 3 }}><NavIcon size={16} color={C.brandInk} /></View>
              <Text style={styles.whereTxt}>{COPY.whereTitle}</Text>
            </View>
            <PressScale onPress={() => router.push('/address')} haptic style={{ marginTop: 21 }} scaleTo={0.95}>
              <View style={styles.cta}><Text style={styles.ctaTxt}>{COPY.addAddress}</Text></View>
            </PressScale>
          </Animated.View>
        ) : (
          <Animated.View key="place" entering={FadeIn.duration(200)}>
            <View style={styles.whereRow}>
              <View style={{ marginTop: 3 }}><NavIcon size={16} color={C.brandInk} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.whereTxt, { marginLeft: 0 }]} numberOfLines={1}>Delivering to {address.title}</Text>
                <Text style={styles.bottomSub} numberOfLines={1}>{address.line}</Text>
              </View>
              <Pressable onPress={() => router.push('/address')}><Text style={styles.change}>Change</Text></Pressable>
            </View>
            {DEMO ? (
              <PressScale onPress={() => setNotice(Date.now())} disabled={count === 0} haptic style={{ marginTop: 21 }} scaleTo={0.95}>
                <View style={styles.cta}><Text style={styles.ctaTxt}>Place order  |  {rupee(toPay)}</Text></View>
              </PressScale>
            ) : (
              <PressScale onPress={() => setNotice(Date.now())} disabled={count === 0 || closedNow} haptic style={{ marginTop: 21 }} scaleTo={0.95}>
                <View style={[styles.cta, (count === 0 || closedNow) && { backgroundColor: C.brandSoft }]}>
                  <Text style={styles.ctaTxt}>{closedNow ? LIVE.closedCta : `Place order  |  ${money(toPay)}${live.feeKnown ? '' : ' + delivery'}`}</Text>
                </View>
              </PressScale>
            )}
          </Animated.View>
        )}
      </View>

      {veil && <Animated.View exiting={FadeOut.duration(220)} style={styles.veil} pointerEvents="auto" />}

      {!!notice && (
        <Animated.View key={notice} entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[styles.toast, { bottom: bottomPad + 150 }]} accessibilityRole="alert">
          <Text style={styles.toastTxt}>{DEMO ? 'Ordering opens soon. This is a preview.' : LIVE.notice}</Text>
        </Animated.View>
      )}

      {hurray && <HurrayModal onClose={closeHurray} sub={DEMO ? COPY.hurraySub : LIVE.hurraySub(live.freeCount)} />}
      {login && <LoginSheet onClose={() => setLogin(false)} />}
    </View>
  );
}

/* ------------------------------------------------------------------ */

/** Black-outlined "−  1  +" pill used on the cart lines (60 × 26). */
function Stepper({ product, qty }: { product: Product; qty: number }) {
  const { add, remove } = cartActions;
  return (
    <View style={styles.stepper}>
      <Pressable hitSlop={6} onPress={() => { tap(); remove(product.id); }} style={styles.stepBtn}><Text style={styles.stepSign}>-</Text></Pressable>
      <Animated.Text key={qty} entering={FadeIn.duration(150)} style={styles.stepQty}>{qty}</Animated.Text>
      <Pressable hitSlop={6} onPress={() => { tap(); add(product); }} style={styles.stepBtn}><Text style={styles.stepSign}>+</Text></Pressable>
    </View>
  );
}

function CheckBox({ on }: { on: boolean }) {
  const s = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    s.value = withSpring(on ? 1 : 0, { damping: 12, stiffness: 300 });
  }, [on]);
  const a = useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: s.value }] }));
  return (
    <View style={[styles.checkBox, on && { borderColor: C.brandDeep }]}>
      <Animated.View style={[styles.checkFill, a]}><Text style={styles.checkTick}>✓</Text></Animated.View>
    </View>
  );
}

/** "Tap here if you need cutlery" — black pill hanging under the Cutlery chip. */
function CutleryTip({ onClose }: { onClose: () => void }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View style={styles.tipArrow} />
      <View style={styles.tip}>
        <Text style={styles.tipTxt}>{COPY.cutleryTip}</Text>
        <Pressable hitSlop={10} onPress={onClose} style={styles.tipX}><CloseIcon size={7} color="#fff" stroke={3} /></Pressable>
      </View>
    </View>
  );
}

function Row({ icon, label, right, h = 49.5, rotate }: { icon: React.ReactNode; label: string; right?: React.ReactNode; h?: number; rotate?: boolean }) {
  return (
    <View style={[styles.row, { height: h }]}>
      <View style={styles.sq}>{icon}</View>
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      {rotate ? <View style={{ transform: [{ rotate: '-90deg' }] }}>{right}</View> : right}
    </View>
  );
}

function BillRow({ l, r, dashed }: { l: string; r: React.ReactNode; dashed?: boolean }) {
  return (
    <View style={styles.billRow}>
      <View>
        <Text style={styles.billL}>{l}</Text>
        {dashed && <Dashed color="#8E8E96" style={{ position: 'absolute', left: 0, right: 0, bottom: 2 }} />}
      </View>
      {r}
    </View>
  );
}

function Dashed({ color = '#E2E2E6', style }: { color?: string; style?: object }) {
  return (
    <View style={[{ height: 1, overflow: 'hidden' }, style]}>
      <Svg width="100%" height={1}><Line x1={0} y1={0.5} x2="100%" y2={0.5} stroke={color} strokeWidth={1} strokeDasharray="3 2" /></Svg>
    </View>
  );
}

function InstructionChips() {
  const opts = ['Leave at door', 'Avoid calling', "Don't ring bell", 'Pet at home'];
  const [on, setOn] = useState<string[]>([]);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 15, paddingBottom: 14 }}>
      {opts.map((o) => {
        const a = on.includes(o);
        return (
          <PressScale key={o} haptic onPress={() => setOn((s) => (a ? s.filter((x) => x !== o) : [...s, o]))}
            style={[styles.chip, a && { borderColor: C.brandDeep, backgroundColor: C.brand }]}>
            <Text style={[styles.chipTxt, a && { color: C.brandInk }]}>{o}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

/** "COMPLETE YOUR MEAL": three tiles; grey placeholders first, then the tiles pop in. */
function MealCard({ ready }: { ready: boolean }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setShown(true), 500);
    return () => clearTimeout(t);
  }, [ready]);
  return (
    <View style={[styles.card, { paddingTop: 17, paddingBottom: 12 }]}>
      <Text style={styles.mealTitle}>{COPY.mealTitle}</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 13 }}>
        {MEAL_PICKS.map(({ product: p, emoji, bg }, i) => (
          <View key={p.id} style={{ width: 69 }}>
            {shown ? (
              <Animated.View entering={FadeIn.delay(i * 60).duration(200)} style={[styles.mealTile, { backgroundColor: bg }]}>
                <Text style={{ fontSize: 34 }}>{emoji}</Text>
                <View style={styles.mealAdd}><MealAdd product={p} /></View>
              </Animated.View>
            ) : (
              <Skeleton w={69} h={64} r={8} />
            )}
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 5 }}>
              <View style={{ marginTop: 3 }}><VegMark size={11} color={C.veg} /></View>
              <Text style={styles.mealName} numberOfLines={2}>{p.name}</Text>
            </View>
            <Text style={styles.mealPrice}>{rupee(p.selling_price)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Small outlined "+" on a meal tile (video: 19 pt circle); shows the count once added. */
function MealAdd({ product }: { product: Product }) {
  const q = useCartSelect((c) => c.qty[product.id] ?? 0);
  return (
    <PressScale haptic onPress={() => cartActions.add(product)} style={[styles.mealPlus, q > 0 && { backgroundColor: C.brand, borderColor: C.brandDeep }]} scaleTo={0.85}>
      <Text style={[styles.mealPlusTxt, q > 0 && { color: C.brandInk, fontSize: 11 }]}>{q > 0 ? q : '+'}</Text>
    </PressScale>
  );
}

/** "Hurray! Free delivery Unlocked!" — pops in fast, a right-anchored bar drains for 5 s. */
function HurrayModal({ onClose, sub }: { onClose: () => void; sub: string }) {
  const drain = useSharedValue(1);
  const pop = useSharedValue(0);
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); onClose(); };
  useEffect(() => {
    pop.value = withSpring(1, { damping: 20, stiffness: 340 });
    drain.value = withTiming(0, { duration: 5000, easing: Easing.linear }, (done) => {
      if (done) scheduleOnRN(close);
    });
  }, []);
  const bar = useAnimatedStyle(() => ({ width: `${drain.value * 100}%` }));
  const box = useAnimatedStyle(() => ({ opacity: interpolate(pop.value, [0, 0.35], [0, 1], 'clamp'), transform: [{ scale: 0.8 + pop.value * 0.2 }] }));
  if (!open) return null;
  return (
    <Animated.View entering={FadeIn.duration(80)} exiting={FadeOut.duration(150)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => { tap(); close(); }} />
      <Animated.View style={[styles.modal, box]}>
        <Pressable onPress={() => { tap(); close(); }} style={styles.modalX} hitSlop={8}><CloseIcon size={10} color="#fff" stroke={3} /></Pressable>
        <View style={styles.mascotCircle}><Text style={{ fontSize: 70 }}>🛵</Text></View>
        <Text style={styles.modalTitle}>{COPY.hurrayTitle}</Text>
        <Text style={styles.modalSub}>{sub}</Text>
        <PressScale onPress={() => { tap(); close(); }} style={styles.yay} scaleTo={0.95}>
          <Text style={styles.yayTxt}>{COPY.hurrayCta}</Text>
        </PressScale>
        <View style={styles.drainTrack}><Animated.View style={[styles.drain, bar]} /></View>
      </Animated.View>
    </Animated.View>
  );
}

/* ---------- live mode (DEMO=false) pieces ---------- */

/** One cart line at Blynk's effective LKR price; an unavailable line is flagged with a Remove button. */
function LiveLine({ product: p, qty, showSavings }: { product: Product; qty: number; showSavings: boolean }) {
  // the struck regular price shows only while Admin's show_offer_savings is on
  const offer = showSavings && p.is_available && isOfferActive(p);
  return (
    <Animated.View exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={styles.itemRow}>
      <ProductImage product={p} size={30} radius={6} style={!p.is_available && { opacity: 0.45 }} />
      <View style={{ flex: 1, marginLeft: 6 }}>
        <Text style={[styles.itemName, { marginLeft: 0 }, !p.is_available && { color: '#8A8A90' }]} numberOfLines={1}>{p.name}</Text>
        {!p.is_available && <Text style={styles.unavail}>{LIVE.unavailable}</Text>}
      </View>
      {p.is_available ? (
        <Stepper product={p} qty={qty} />
      ) : (
        <PressScale onPress={() => cartActions.setQty(p, 0)} style={styles.removeBtn}><Text style={styles.removeTxt}>{LIVE.remove}</Text></PressScale>
      )}
      <View style={[styles.priceCol, { width: 78 }]}>
        {offer && <Text style={styles.itemStrike}>{formatLkr(round2(p.selling_price * qty))}</Text>}
        {p.is_available && <Text style={[styles.itemPrice, { fontSize: 13 }]}>{formatLkr(round2(effectivePrice(p) * qty))}</Text>}
      </View>
    </Animated.View>
  );
}

/** "COMPLETE YOUR BASKET": other available Blynk products, nearest aisles first. Hidden when there are none. */
function LiveBasket({ ready, products, inCart }: { ready: boolean; products: Product[]; inCart: Product[] }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setShown(true), 500);
    return () => clearTimeout(t);
  }, [ready]);
  const have = new Set(inCart.map((p) => p.id));
  const cats = new Set(inCart.map((p) => p.category_id));
  const pool = products.filter((p) => p.is_available && !have.has(p.id));
  const picks = [...pool.filter((p) => cats.has(p.category_id)), ...pool.filter((p) => !cats.has(p.category_id))].slice(0, 3);
  if (!picks.length) return null;
  return (
    <View style={[styles.card, { paddingTop: 17, paddingBottom: 12 }]}>
      <Text style={styles.mealTitle}>{LIVE.mealTitle}</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 13 }}>
        {picks.map((p, i) => (
          <View key={p.id} style={{ width: 69 }}>
            {shown ? (
              <Animated.View entering={FadeIn.delay(i * 60).duration(200)} style={styles.mealTile}>
                <ProductImage product={p} size={64} radius={8} />
                <View style={styles.mealAdd}><MealAdd product={p} /></View>
              </Animated.View>
            ) : (
              <Skeleton w={69} h={64} r={8} />
            )}
            <Text style={[styles.mealName, { marginTop: 5 }]} numberOfLines={2}>{p.name}</Text>
            <Text style={[styles.mealPrice, isOfferActive(p) && { color: C.brandText }]}>{formatLkr(effectivePrice(p))}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The bill with Blynk's own numbers: item total (struck regular total only when offer savings
 * are switched on and an offer is active), the delivery fee as /store sets it, the true "no
 * packaging or platform fee" line, and To Pay. No taxes, distances or invented savings.
 */
function LiveBillCard({ bill, itemTotal, mrpTotal }: { bill: LiveBill; itemTotal: number; mrpTotal: number }) {
  const free = bill.freeCount > 0;
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0, overflow: 'hidden' }]}>
      {free && <StampBadge variant="free" size={70} style={{ position: 'absolute', right: -2, top: -2 }} />}
      <View style={styles.billHead}>
        <View style={styles.sq}><ReceiptGlyph /></View>
        <View>
          <Text style={styles.payLine}>
            To Pay {bill.showSaved && <Text style={styles.payStrike}>{formatLkr(bill.toPayRegular)} </Text>}{formatLkr(bill.toPay)}
          </Text>
          <Text style={[styles.savedTxt, !bill.showSaved && { color: '#6E6E76' }]}>
            {bill.showSaved ? `${formatLkr(bill.saved)} saved on the total!` : bill.feeKnown ? 'Includes the delivery fee' : 'Delivery fee confirmed at checkout'}
          </Text>
        </View>
      </View>
      <View style={[styles.sep, { marginHorizontal: 0 }]} />
      <View style={{ paddingHorizontal: 15, paddingTop: 12 }}>
        <BillRow l="Item Total" r={(
          <Text style={styles.billR}>
            {bill.showSaved && <Text style={styles.billStrike}>{formatLkr(mrpTotal)} </Text>}
            <Text style={bill.showSaved ? { color: C.brandText } : undefined}>{formatLkr(itemTotal)}</Text>
          </Text>
        )} />
        <Dashed style={{ marginVertical: 11 }} />
        <BillRow dashed l="Delivery Fee" r={<Text style={[styles.billR, free && { color: C.brandText }]}>{bill.feeText}</Text>} />
        {free && <Text style={styles.freeNote}>{LIVE.freeNote(bill.freeCount)}</Text>}
      </View>
      <Animated.View entering={FadeIn.duration(250)} style={styles.thatsIt}>
        <LinearGradient colors={[C.brandTint, 'rgba(255,248,214,0)']} start={{ x: 0.55, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        <Text style={styles.thatsItTxt}>{LIVE.thatsIt}</Text>
      </Animated.View>
      <View style={[styles.billRow, { paddingHorizontal: 15, height: 46 }]}>
        <Text style={styles.payTotal}>To Pay</Text>
        <Text style={styles.payTotal}>{formatLkr(bill.toPay)}{bill.feeKnown ? '' : ' + delivery'}</Text>
      </View>
    </Animated.View>
  );
}

/** Login bottom sheet: floating "Mobile Number" label; Continue lights up at 10 digits (live: +94 and 9). */
function LoginSheet({ onClose }: { onClose: () => void }) {
  const [num, setNum] = useState('');
  // live: Sri Lankan mobiles, 9 digits after +94 (a leading 0 is dropped); nothing is sent
  const ready = DEMO ? /^\d{10}$/.test(num) : LIVE.phoneOk(num);
  const lift = useSharedValue(0);
  const en = useSharedValue(0);
  const rise = useSharedValue(0);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    rise.value = withTiming(1, { duration: 340, easing: Easing.out(Easing.cubic) });
  }, []);
  useEffect(() => {
    lift.value = withTiming(num.length > 0 ? 1 : 0, { duration: 160 });
    en.value = withTiming(ready ? 1 : 0, { duration: 200 });
  }, [num]);
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - rise.value) * 400 }] }));
  const label = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(lift.value, [0, 1], [0, -22]) }, { scale: interpolate(lift.value, [0, 1], [1, 0.72]) }],
  }));
  const btn = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(en.value, [0, 1], [C.brandSoft, C.brand]) }));
  const submit = () => {
    Keyboard.dismiss();
    onClose();
    router.push({ pathname: '/otp', params: { phone: num } });
  };
  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View style={[styles.sheet, sheet]}>
        <Text style={styles.sheetTitle}>{COPY.login}</Text>
        <Text style={styles.sheetSub}>{COPY.loginSub}</Text>
        <Pressable onPress={() => input.current?.focus()} style={styles.phoneRow}>
          <View style={styles.ccBox}>
            <Text style={styles.flag}>{DEMO ? COPY.countryFlag : LIVE.countryFlag}</Text>
            <View style={styles.ccUnder}><Text style={styles.cc}>{DEMO ? COPY.countryCode : LIVE.countryCode}</Text></View>
            <ChevronIcon size={15} color="#555" stroke={1.8} />
          </View>
          <View style={styles.numBox}>
            <Animated.Text style={[styles.floatLabel, label]}>{COPY.mobileLabel}</Animated.Text>
            <TextInput
              ref={input}
              autoFocus
              value={num}
              onChangeText={(t) => setNum(DEMO ? t.replace(/\D/g, '').slice(0, 10) : t.replace(/\D/g, '').replace(/^0/, '').slice(0, LIVE.phoneDigits))}
              keyboardType="number-pad"
              style={styles.phoneInput}
              maxLength={10}
              accessibilityLabel={COPY.mobileLabel}
            />
          </View>
        </Pressable>
        <PressScale disabled={!ready} onPress={submit} haptic scaleTo={0.96}>
          <Animated.View style={[styles.cta, btn]}><Text style={[styles.ctaTxt, { fontSize: 14.5 }]}>{COPY.continue}</Text></Animated.View>
        </PressScale>
        <Text style={styles.terms}>
          By clicking, I accept the <Text style={styles.link}>privacy policy</Text> and <Text style={styles.link}>terms of use</Text>
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** Loading skeleton, laid out bar for bar like the video's (0:41.6–0:43.2). */
function CartSkeleton({ top, bottomPad }: { top: number; bottomPad: number }) {
  const bar = (w: number | `${number}%`, h = 14, extra?: object) => <Skeleton w={w} h={h} r={3} style={[{ backgroundColor: SK }, extra]} />;
  return (
    <Animated.View entering={FadeIn.duration(120)} style={{ flex: 1, backgroundColor: C.bg, paddingTop: top }}>
      <View style={{ height: 50, justifyContent: 'center', paddingLeft: 15 }}><BackIcon size={20} color={TEXT} stroke={1.8} /></View>
      <View style={{ paddingHorizontal: 15 }}>
        <Skeleton h={40} r={12} style={{ marginTop: 13, backgroundColor: SK }} />
        {bar(107, 13, { marginTop: 34 })}
        <View style={[styles.skCard, { marginTop: 20, paddingTop: 15, paddingBottom: 19 }]}>
          <View style={styles.skRow}>{bar(194)}{bar(65)}</View>
          <View style={[styles.skRow, { marginTop: 15 }]}>{bar(129, 15)}{bar(65, 15)}</View>
          <View style={{ height: 1, backgroundColor: '#F4EFD8', marginTop: 15, marginHorizontal: -15 }} />
          <View style={[styles.skRow, { marginTop: 25, alignItems: 'center' }]}>{bar(260, 15)}<Skeleton w={18} h={18} r={9} style={{ backgroundColor: SK }} /></View>
        </View>
        {bar(160, 13, { marginTop: 35 })}
        <View style={[styles.skCard, { marginTop: 21, paddingTop: 14, height: 74 }]}>{bar(129)}{bar(194, 14, { marginTop: 14 })}</View>
        <View style={[styles.skCard, { marginTop: 18, paddingTop: 13, height: 99 }]}>{bar(129)}{bar(243, 14, { marginTop: 14 })}{bar(243, 14, { marginTop: 13 })}</View>
        {bar(195, 13, { marginTop: 36 })}
        <View style={[styles.skCard, { marginTop: 21, paddingTop: 14, height: 120 }]}>{bar(129)}{bar(243, 14, { marginTop: 14 })}</View>
      </View>
      <View style={[styles.bottom, { paddingTop: 15, paddingBottom: bottomPad, flexDirection: 'row', justifyContent: 'space-between' }]}>
        <View>{bar(71)}{bar(115, 12, { marginTop: 14 })}</View>
        <Skeleton w={177} h={40} r={4} style={{ backgroundColor: SK }} />
      </View>
    </Animated.View>
  );
}

/* ---------- small glyphs (ink on the yellow squares) ---------- */
const PlusGlyph = () => (
  <Svg width={14} height={14} viewBox="0 0 24 24"><Path d="M12 4v16M4 12h16" stroke="#444" strokeWidth={2} strokeLinecap="round" /></Svg>
);
const PenGlyph = ({ white }: { white?: boolean }) => (
  <Svg width={white ? 11 : 15} height={white ? 11 : 15} viewBox="0 0 24 24" fill="none">
    <Path d="M4 20l1-5L16 4l4 4L9 19l-5 1z" stroke={white ? C.brandInk : '#444'} strokeWidth={white ? 2.6 : 1.8} strokeLinejoin="round" fill={white ? C.brandInk : 'none'} />
    {!white && <Path d="M13 20h7" stroke="#444" strokeWidth={1.8} strokeLinecap="round" />}
  </Svg>
);
const TagGlyph = () => (
  <Svg width={11} height={11} viewBox="0 0 24 24"><Path d="M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9z" fill={C.brandInk} /><Circle cx={8} cy={8} r={2} fill={C.brand} /></Svg>
);
const BagGlyph = () => (
  <Svg width={11} height={12} viewBox="0 0 22 24"><Rect x={3} y={7} width={16} height={15} rx={2} fill={C.brandInk} /><Path d="M7 7V5a4 4 0 018 0v2" stroke={C.brandInk} strokeWidth={2.4} fill="none" /><Circle cx={11} cy={14} r={2.5} fill={C.brand} /></Svg>
);
const ReceiptGlyph = () => (
  <Svg width={10} height={11} viewBox="0 0 20 22"><Path d="M2 1h16v20l-4-2-4 2-4-2-4 2z" fill={C.brandInk} /><Path d="M6 7h8M6 11h8" stroke={C.brand} strokeWidth={2} /></Svg>
);

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', height: 38, paddingLeft: 14, gap: 11 },
  backTitle: { fontFamily: F.regular, color: '#6E6E76', fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 15, marginHorizontal: 15, marginBottom: 15 },
  itemsCard: { paddingTop: 8, paddingBottom: 14, paddingHorizontal: 0, overflow: 'hidden' },
  itemRow: { flexDirection: 'row', alignItems: 'center', height: 47, paddingLeft: 15, paddingRight: 15 },
  itemName: { flex: 1, fontFamily: F.medium, fontSize: 13, color: INK, marginLeft: 4, letterSpacing: -0.1 },
  priceCol: { width: 38, alignItems: 'flex-end' },
  itemStrike: { fontFamily: F.regular, fontSize: 10.5, color: '#8A8A90', textDecorationLine: 'line-through', lineHeight: 12 },
  itemPrice: { fontFamily: F.regular, fontSize: 14, color: INK },
  stepper: {
    width: 60, height: 26, borderRadius: 13, borderWidth: 1.4, borderColor: INK, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 4,
  },
  stepBtn: { width: 14, alignItems: 'center' },
  stepSign: { fontFamily: F.semi, fontSize: 13, color: INK, lineHeight: 16 },
  stepQty: { fontFamily: F.medium, fontSize: 13.5, color: INK },
  chips: { paddingLeft: 15, gap: 8 },
  chip: {
    height: 33, borderRadius: 17, borderWidth: 1, borderColor: '#E4E4EA', flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, gap: 6, backgroundColor: '#fff',
  },
  chipTxt: { fontFamily: F.regular, fontSize: 12, color: '#4A4A52' },
  checkBox: { width: 16, height: 16, borderRadius: 3, borderWidth: 1.3, borderColor: '#9A9AA2', overflow: 'hidden' },
  checkFill: { flex: 1, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  checkTick: { color: C.brandInk, fontSize: 10, fontFamily: F.black, lineHeight: 12 },
  tipWrap: { position: 'absolute', left: 149, bottom: -20, zIndex: 5 },
  tipArrow: {
    width: 0, height: 0, marginRight: 24, borderLeftWidth: 6.5, borderRightWidth: 6.5, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#0B0B0D',
  },
  tip: { height: 36, borderRadius: 18, backgroundColor: '#0B0B0D', flexDirection: 'row', alignItems: 'center', paddingLeft: 11, paddingRight: 10, gap: 9 },
  tipTxt: { color: '#fff', fontFamily: F.semi, fontSize: 12.5, letterSpacing: -0.2 },
  tipX: { width: 15, height: 15, borderRadius: 8, backgroundColor: '#3A3A3E', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  sq: { width: 18, height: 18, borderRadius: 4.5, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: F.regular, fontSize: 13.3, color: TEXT, marginLeft: 11, letterSpacing: -0.1 },
  sep: { height: 1, backgroundColor: LINE },
  applied: { fontFamily: F.semi, color: C.brandText, fontSize: 12.5 },
  billHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingHorizontal: 16, paddingTop: 14, height: 66 },
  payLine: { fontFamily: F.medium, fontSize: 13, color: INK, lineHeight: 17 },
  payStrike: { color: '#6E6E76', textDecorationLine: 'line-through', fontFamily: F.regular },
  savedTxt: { fontFamily: F.medium, color: C.brandText, fontSize: 12.1, marginTop: 1 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billL: { fontFamily: F.regular, fontSize: 12.6, color: GREY, lineHeight: 22 },
  billR: { fontFamily: F.regular, fontSize: 12.6, color: TEXT },
  billStrike: { color: '#6E6E76', textDecorationLine: 'line-through' },
  freeNote: { fontFamily: F.regular, fontSize: 11.5, color: '#7A7A82', marginTop: 8, lineHeight: 16 },
  thatsIt: { height: 28, justifyContent: 'center', paddingHorizontal: 15, marginTop: 15, overflow: 'hidden' },
  thatsItTxt: { fontFamily: F.medium, fontSize: 12.3, color: C.brandText, letterSpacing: -0.1 },
  payTotal: { fontFamily: F.semi, fontSize: 12.8, color: INK },
  policyTitle: { fontFamily: F.semi, fontSize: 12, color: '#A3A3AA', marginHorizontal: 23, marginTop: 10 },
  policy: { fontFamily: F.regular, fontSize: 12, color: '#A8A8AE', marginHorizontal: 23, marginTop: 1, lineHeight: 16.5 },
  bottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', paddingHorizontal: 15, paddingTop: 22, zIndex: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8,
  },
  bottomTitle: { fontFamily: F.semi, fontSize: 16, color: INK, lineHeight: 22 },
  bottomSub: { fontFamily: F.regular, fontSize: 12.2, color: '#6E6E76', marginTop: 4, lineHeight: 18 },
  whereRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 2 },
  whereTxt: { flex: 1, fontFamily: F.semi, fontSize: 16.8, color: TEXT, lineHeight: 21 },
  change: { fontFamily: F.bold, color: C.brandText, fontSize: 13 },
  cta: { height: 50, borderRadius: 25, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 16 },
  veil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255,255,255,0.4)', zIndex: 40 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 50 },
  modal: { width: 290, backgroundColor: '#fff', borderRadius: 16, paddingTop: 19, paddingBottom: 29, alignItems: 'center', overflow: 'hidden' },
  modalX: { position: 'absolute', right: 12, top: 12, width: 22, height: 22, borderRadius: 11, backgroundColor: '#D6D6DA', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  mascotCircle: { width: 135, height: 135, borderRadius: 68, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontFamily: F.bold, fontSize: 21.5, color: '#141414', textAlign: 'center', marginTop: 22, lineHeight: 24, letterSpacing: -0.3 },
  modalSub: { fontFamily: F.regular, fontSize: 13, color: '#55555C', marginTop: 4 },
  yay: { alignSelf: 'stretch', marginHorizontal: 15, marginTop: 38, height: 50, borderRadius: 25, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  yayTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 15.5 },
  drainTrack: { position: 'absolute', left: 0, right: 0, bottom: 2, height: 4, alignItems: 'flex-end' },
  drain: { height: 4, backgroundColor: C.brandDeep, borderTopLeftRadius: 2, borderBottomLeftRadius: 2 },
  sheet: { alignSelf: 'stretch', height: 547, backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 15, paddingTop: 16 },
  sheetTitle: { fontFamily: F.semi, fontSize: 17.5, color: INK, lineHeight: 22 },
  sheetSub: { fontFamily: F.regular, fontSize: 12, color: '#6E6E76', marginTop: 0, lineHeight: 16 },
  phoneRow: { flexDirection: 'row', alignItems: 'flex-end', height: 36, marginTop: 19, marginBottom: 28 },
  ccBox: { flexDirection: 'row', alignItems: 'center', height: 26, gap: 8, width: 84 },
  flag: { fontSize: 14 },
  ccUnder: { borderBottomWidth: 1, borderBottomColor: '#EDEDF0', paddingBottom: 1 },
  cc: { fontFamily: F.regular, fontSize: 13.5, color: TEXT },
  numBox: { flex: 1, height: 26, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#E6E6EA' },
  floatLabel: { position: 'absolute', left: 0, fontFamily: F.regular, color: '#8A8A90', fontSize: 13.5, transformOrigin: 'left' },
  phoneInput: { fontFamily: F.medium, fontSize: 13.5, color: TEXT, letterSpacing: 0, paddingVertical: 0, outlineStyle: 'none' } as object,
  terms: { fontFamily: F.regular, fontSize: 13.4, color: '#6E6E76', textAlign: 'center', marginTop: 16 },
  link: { textDecorationLine: 'underline', color: INK, fontFamily: F.semi },
  mealTitle: { fontFamily: F.semi, fontSize: 12.5, color: '#7A7A82', letterSpacing: 2 },
  mealPlus: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.4, borderColor: C.brandInk, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  mealPlusTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 15, lineHeight: 17, marginTop: -1 },
  mealTile: { width: 69, height: 64, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mealAdd: { position: 'absolute', top: -1, right: -1 },
  mealName: { flex: 1, fontFamily: F.regular, fontSize: 12, color: TEXT, lineHeight: 15.5 },
  mealPrice: { fontFamily: F.regular, fontSize: 12, color: TEXT, marginTop: 2 },
  skCard: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 15, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } },
  skRow: { flexDirection: 'row', justifyContent: 'space-between' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  emptyTitle: { fontFamily: F.bold, fontSize: 18, color: INK, marginTop: 12, marginBottom: 6 },
  toast: { position: 'absolute', left: 24, right: 24, backgroundColor: C.ink, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', zIndex: 60 },
  toastTxt: { color: '#fff', fontFamily: F.semi, fontSize: 13.5 },
  warn: { fontFamily: F.medium, fontSize: 12, color: C.problem, marginHorizontal: 23, marginBottom: 10 },
  unavail: { fontFamily: F.semi, fontSize: 11, color: C.problem, marginTop: 1 },
  removeBtn: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1.2, borderColor: C.problem, justifyContent: 'center' },
  removeTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.problem },
});
