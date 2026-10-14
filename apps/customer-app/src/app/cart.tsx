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
import { getCombos } from '@/blynk/api/catalog';
import type { Product } from '@/blynk/api/types';
import { keyOf, lineAvailable, lineKey, linePriced, lineUnitPrice, needsVariant, type CartLine, type ComboLine } from '@/blynk/cart/cartStore';
import { fetchProductDetail } from '@/blynk/catalog/product';
import { openSizePicker, rememberDetail } from '@/blynk/catalog/sizePicker';
import { hasVariants, priceText, VARIANT_COPY } from '@/blynk/catalog/variants';
import { LeadTimeCard } from '@/blynk/checkout/LeadTimeCard';
import { canOrderWithLead, cartLead, cartProductIds, LEAD_COPY, leadState, slotsFromLead } from '@/blynk/checkout/leadTime';
import { requestOtp } from '@/blynk/auth/api';
import { setPendingOtp } from '@/blynk/auth/flow';
import { authErrorText } from '@/blynk/auth/forms';
import { toE164 } from '@/blynk/auth/phone';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { addressSummary } from '@/blynk/address/api';
import { clearSelection, useDeliveryLocation, type DeliveryLocation } from '@/blynk/address/store';
import { CoverageCard } from '@/blynk/area/AreaSteps';
import { coverageOf } from '@/blynk/area/coverage';
import { ComboAdd, comboHasSaving, ComboThumb, comboSummary } from '@/blynk/combos/ComboViews';
import { couponAppliedNote, couponErrorText, couponInputError, discountLabel, normalizeCoupon } from '@/blynk/checkout/coupon';
import { BirthdayBanner, DeliveryDetailsCard, RewardsCard, SlotPickerCard } from '@/blynk/checkout/CheckoutSections';
import { detailsBody, detailsProblem, EMPTY_DETAILS, type CheckoutDetails } from '@/blynk/checkout/details';
import { birthdayOf, canRedeem, pointsOf, referralOf } from '@/blynk/checkout/rewards';
import { savingsHeader } from '@/blynk/checkout/savings';
import { CLEAR_CART } from '@/blynk/ui/strings';
import { accountStyles as A, Button as SheetButton, Sheet } from '@/blynk/account/ui';
import { OfflineBanner } from '@/components/OfflineBanner';
import { availableSlot, SLOT_COPY, slotForOrder, type DeliverySlots } from '@/blynk/checkout/slots';
import { getCheckoutInfo, getDeliverySlots, placeOrder, previewCoupon } from '@/blynk/orders/api';
import {
  basketProgress, basketPrompt, checkoutBill, checkoutKeyFor, checkoutSignature, forgetCheckoutKey, freeDeliveryNote, orderCombos, orderItems,
  rememberPlaced, type CheckoutBill,
} from '@/blynk/orders/checkout';
import { OUTSIDE_AREA, placeErrorCopy, refusedProduct, stockRefusal, stockRefusalNote, type PlaceErrorCopy } from '@/blynk/orders/errors';
import type { CheckoutInfo, CouponPreview } from '@/blynk/orders/types';
import { openPolicy } from '@/blynk/legal/open';
import { PolicyRow } from '@/blynk/legal/PolicyLinks';
import { formatLkr } from '@/blynk/lib/money';
import { PAY } from '@/blynk/payments/copy';
import { effectiveMethod, methodBody, onlineInfo, onlineOffered, type PayMethod } from '@/blynk/payments/method';
import { PaymentChoice } from '@/blynk/payments/PaymentChoice';
import { requestPushPermission } from '@/blynk/push';
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
import { cartActions, getCartSnapshot, useCart, useCartSelect } from '@/lib/cart';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * Cart, read frame by frame off the reference (video 0:41–1:20). All copy and fees are the
 * video's mock content (src/demo/cart.ts); the item lines come from the cart store.
 * Design mock: login, OTP and address are local previews; nothing is sent, nothing is ordered.
 *
 * Live: "Proceed with phone number" signs in for real (OTP by SMS, then registration on the
 * first sign-in); the signed-in state is a registered Blynk session (src/blynk/auth/session.ts).
 * Signed in, the cart is the checkout: the delivery address comes from the address book
 * (src/blynk/address/store.ts), the fee from GET /orders/checkout-info for that address, and
 * "Place order" POSTs /orders with an idempotency key, so a double tap or a retry is one order.
 * Payment: cash on delivery, or "Pay online" while GET /store / checkout-info say PayHere is on
 * (the order then waits for payment and /payment/pay posts the PayHere form). Refusals get clear
 * copy (src/blynk/orders/errors.ts).
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
  const { lines, total, mrpTotal, count, address } = cart;
  // signed in: design mock keeps the local number; live is a registered Blynk session
  const session = useSession();
  const midRegistration = !DEMO && needsRegistration(session);
  const phone = DEMO ? cart.phone : (session && !midRegistration ? session.user.phone : null);
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
  const [confirmClear, setConfirmClear] = useState(false);
  const prevPhone = useRef(phone);

  /* ---- live checkout (signed in): address, quote, coupon, place order ---- */
  const loc = useDeliveryLocation();
  const addr = DEMO || !phone ? null : loc.address;
  const items = orderItems(lines);
  // combo packs go out as `combos` (the server charges the combo price)
  const combos = orderCombos(cart.combos);
  const hasLines = items.length + combos.length > 0;
  const itemsSig = checkoutSignature({ items, combos, addressId: '' });
  // receiver, needs help, quick notes and the rider note (the quick picks also show signed out)
  const [details, setDetails] = useState<CheckoutDetails>(EMPTY_DETAILS);
  const notes = details.noteChips;
  const setNotes = (f: (s: string[]) => string[]) => setDetails((d) => ({ ...d, noteChips: f(d.noteChips) }));
  const [showDetailErrors, setShowDetailErrors] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  // cash on delivery, or PayHere while staff have it on (src/blynk/payments/method.ts)
  const [payChoice, setPayChoice] = useState<PayMethod>('COD');
  // scheduled delivery: GET /orders/slots while staff have slots on (or the store is closed)
  const [slots, setSlots] = useState<DeliverySlots | null>(null);
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsTick, setSlotsTick] = useState(0);
  const [pickedRaw, setPickedSlot] = useState<string | null>(null);
  // delivery lead time (migration 045): the cart's products go with the slots / checkout-info calls
  const productIds = cartProductIds(lines, cart.combos);
  const idsKey = productIds.join(',');
  const cartLeadNow = cartLead(lines, cart.combos);
  const [quote, setQuote] = useState<CheckoutInfo | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [quoteTick, setQuoteTick] = useState(0);
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const [placeErrState, setPlaceErrState] = useState<{ copy: PlaceErrorCopy; for: string } | null>(null);
  const addrId = addr?.id ?? null;
  const quoteFor = quote && addrId && quote.delivery_fee_address_id === addrId ? quote : null;
  const checkout: CheckoutBill | null = addrId ? checkoutBill(total, quoteFor, coupon, usePoints) : null;
  const payInfo = onlineInfo(store?.online_payment, quoteFor?.online_payment);
  const payMethod = effectiveMethod(payChoice, payInfo, checkout?.toPay ?? null);
  // "For someone else" only while staff allow it (checkout-info; absent = off)
  const forOthers = quoteFor?.order_for_someone_else;
  const allowForOthers = forOthers?.enabled === true;
  const storeOpen = !closedNow;
  // slots are asked for once the store says they are on, while closed (a slot may still be booked),
  // or when the cart holds an item with a lead time (it can only go in a slot)
  const slotsWanted = !DEMO && !!addrId && (store?.delivery_slots_enabled === true || closedNow || cartLeadNow.days > 0);
  const lead = leadState({ cart: cartLeadNow, slots, quote: quoteFor });
  const shownSlots = slotsFromLead(slots, lead);
  const slotsOn = shownSlots?.enabled === true;
  // a picked slot that filled up (or is no longer offered) is dropped: the customer picks again
  const pickedSlot = pickedRaw && shownSlots && !availableSlot(shownSlots, pickedRaw) ? null : pickedRaw;
  const orderable = canOrderWithLead({ storeOpen, slots: slotsOn ? shownSlots : null, picked: pickedSlot, lead });

  useEffect(() => {
    if (!slotsWanted) return;
    const ctrl = new AbortController();
    void Promise.resolve().then(() => { if (!ctrl.signal.aborted) setSlotsLoading(true); });
    getDeliverySlots(ctrl.signal, productIds)
      .then((s) => { setSlots(s); setSlotsFailed(false); })
      .catch(() => { if (!ctrl.signal.aborted) setSlotsFailed(true); })
      .finally(() => { if (!ctrl.signal.aborted) setSlotsLoading(false); });
    return () => ctrl.abort();
  }, [slotsWanted, slotsTick, idsKey]);


  // the fee for the chosen address and this basket (refetched when either changes)
  useEffect(() => {
    if (DEMO || !addrId || !hasLines) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setQuoteFailed(false);
      getCheckoutInfo(addrId, total, ctrl.signal, productIds)
        .then((q) => setQuote(q))
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          // the address went away (deleted elsewhere): choose again
          if (placeErrorCopy(e).action === 'address') clearSelection();
          setQuoteFailed(true);
        });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [addrId, itemsSig, quoteTick]);

  // an applied coupon is re-checked whenever the basket or the address changes
  useEffect(() => {
    if (DEMO || !coupon || !addrId || !hasLines) return;
    let alive = true;
    previewCoupon(coupon.code, items, addrId, combos)
      .then((c) => { if (alive) setCoupon(c); })
      .catch((e) => { if (alive) { setCoupon(null); setCouponErr(couponErrorText(e)); } });
    return () => { alive = false; };
  }, [addrId, itemsSig]);

  // a new address or a changed basket clears the last refusal (kept with the checkout it was for)
  const placeErr = placeErrState && placeErrState.for === `${addrId}|${itemsSig}` ? placeErrState.copy : null;
  const setPlaceErr = (copy: PlaceErrorCopy | null) => setPlaceErrState(copy ? { copy, for: `${addrId}|${itemsSig}` } : null);

  const applyCoupon = async (raw: string) => {
    if (!addrId) return;
    const bad = couponInputError(raw);
    if (bad) { setCouponErr(bad); return; }
    setCouponErr(null);
    try {
      setCoupon(await previewCoupon(normalizeCoupon(raw), items, addrId, combos));
    } catch (e) {
      setCoupon(null);
      setCouponErr(couponErrorText(e));
    }
  };

  const place = async () => {
    if (DEMO || placingRef.current || !addrId || !hasLines || !orderable) return;
    const problem = detailsProblem(details, allowForOthers);
    if (problem) {
      setShowDetailErrors(true);
      setPlaceErr({ title: 'Check the delivery details', message: problem, action: null });
      return;
    }
    const more = detailsBody(details, allowForOthers);
    const slotStart = slotsOn ? slotForOrder(shownSlots, pickedSlot) : undefined;
    // the switch shows only while points can be used; the server decides how many
    const pointsOn = usePoints && canRedeem(pointsOf(quoteFor));
    const extra = {
      ...(slotStart ? { delivery_slot_start: slotStart } : {}),
      ...(pointsOn ? { use_points: true } : {}),
      ...(more.for_someone_else ? { for_someone_else: true, recipient: more.recipient } : {}),
      ...(more.needs_help ? { needs_help: true } : {}),
      ...methodBody(payMethod),
    };
    const note = more.delivery_note ?? '';
    // one key per checkout: a double tap or a retry after a timeout replays the same order
    const sig = checkoutSignature({ items, combos, addressId: addrId, coupon: coupon?.code ?? null, note, extra });
    const key = checkoutKeyFor(sig);
    placingRef.current = true;
    setPlacing(true);
    setPlaceErr(null);
    try {
      const order = await placeOrder({
        address_id: addrId,
        items,
        ...(combos.length ? { combos } : {}),
        idempotency_key: key,
        ...(coupon ? { coupon_code: coupon.code } : {}),
        ...(note ? { delivery_note: note } : {}),
        ...extra,
      });
      forgetCheckoutKey();
      rememberPlaced(order);
      // the moment order updates matter: ask to allow notifications (Flutter cart_screen_payment_container)
      void requestPushPermission();
      if (order.payment_method === 'ONLINE' && order.order_status === 'AWAITING_PAYMENT') {
        // it is an order now (paid with "Pay now" until it expires): the cart starts over
        cartActions.clear();
        router.replace({ pathname: '/payment/pay', params: { order: order.id } } as never);
      } else {
        router.replace({ pathname: '/placed', params: { id: order.id } });
      }
    } catch (e) {
      const copy = placeErrorCopy(e);
      const gone = refusedProduct(e);
      // sold out / only N left / a size (migration 045): the cart follows the refusal at once
      const refusal = stockRefusal(e);
      if (refusal) {
        cartActions.applyRefusal(refusal);
        // the message stays with the updated cart (a changed basket clears an old refusal)
        const after = getCartSnapshot();
        const sigAfter = checkoutSignature({ items: orderItems(after.lines), combos: orderCombos(after.combos), addressId: '' });
        setPlaceErrState({ copy: { ...copy, message: `${copy.message} ${stockRefusalNote(refusal)}` }, for: `${addrId}|${sigAfter}` });
      } else {
        setPlaceErr(gone?.name ? { ...copy, message: `${gone.name} isn't available right now. Remove it and try again.` } : copy);
      }
      if (copy.action === 'stock') { void refresh(); refreshCombos(); }
      // fresh prices and availability: the catalogue reconciles the cart lines
      if (copy.action === 'reconcile') { void refresh(); refreshCombos(); }
      if (copy.action === 'coupon') { setCoupon(null); setCouponErr(couponErrorText(e)); }
      if (copy.action === 'address' || copy.action === 'details') setQuoteTick((n) => n + 1);
      // the slot went, or the store closed after all: fresh slots so one can be picked
      if (copy.action === 'slot') setPickedSlot(null);
      if (copy.action === 'slot' || copy.action === 'closed') setSlotsTick((n) => n + 1);
      // "Pay online" was refused (switched off / nothing to pay): back to cash, fresh checkout-info
      if (copy.action === 'payment') { setPayChoice('COD'); setQuoteTick((n) => n + 1); }
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  };

  useEffect(() => {
    const a = setTimeout(() => setLoading(false), SKELETON_MS);
    if (DEMO) {
      const b = setTimeout(() => lines.length && setHurray(true), SKELETON_MS + 60);
      return () => { clearTimeout(a); clearTimeout(b); };
    }
    // live: fresh prices and availability for what is in the cart (the catalogue reconciles the cart)
    if (lines.length) void refresh().then((ok) => setRefreshFailed(!ok));
    // size lines: each product's sizes re-read for their own price and stock (the list has none)
    refreshVariantLines(lines);
    if (cart.combos.length) refreshCombos();
    return () => clearTimeout(a);
  }, []);

  // live: the "Hurray" modal is Admin's new-customer free deliveries; without them the fee
  // header still bursts once the cart has shown (there is no modal to wait for)
  const liveFree = live.freeCount > 0;
  const storeSeen = !!store;
  useEffect(() => {
    if (DEMO || loading || !storeSeen || !(lines.length || cart.combos.length)) return;
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

  if (lines.length === 0 && cart.combos.length === 0 && !loading) {
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
        {!DEMO && <OfflineBanner onRetry={() => void refresh()} style={{ marginHorizontal: 15, marginBottom: 15 }} />}
        {!DEMO && <ClosedBanner style={{ marginHorizontal: 15, marginBottom: 15 }} />}
        {!DEMO && refreshFailed && <Text style={styles.warn}>{LIVE.refreshFailed}</Text>}
        {/* the birthday gift, while the server says it applies (signed in, with an address) */}
        {!DEMO && checkout && <BirthdayBanner birthday={birthdayOf(quoteFor)} />}

        {/* items */}
        <View style={{ zIndex: 3 }}>
          <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, styles.itemsCard]}>
            {/* combo packs first (Flutter _CartComboList), each with what is inside */}
            {!DEMO && cart.combos.map((l) => <ComboCartLine key={`combo-${l.combo.id}`} line={l} />)}
            {lines.map(({ product: p, quantity, variant }) => (DEMO ? (
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
              <LiveLine key={lineKey(p.id, variant?.id)} line={{ product: p, quantity, variant }} showSavings={store?.show_offer_savings === true} />
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

        {/* delivery lead time: which item needs days, its first delivery day (or that slots are off) */}
        {!DEMO && checkout && <LeadTimeCard lead={lead} />}

        {/* delivery time: only while staff have slots on (GET /orders/slots) */}
        {!DEMO && checkout && slotsWanted && (
          <SlotPickerCard
            slots={shownSlots}
            failed={slotsFailed}
            loading={slotsLoading}
            storeOpen={storeOpen}
            picked={pickedSlot}
            onPick={setPickedSlot}
            onRetry={() => setSlotsTick((n) => n + 1)}
            asapAllowed={lead.asapAllowed}
            note={lead.days > 0 ? LEAD_COPY.slotNote(lead.dateLabel) : null}
          />
        )}

        {/* signed in with an address: who it is for, needs help, the rider note; else the quick notes */}
        {!DEMO && checkout ? (
          <DeliveryDetailsCard
            details={details}
            setDetails={setDetails}
            allowForSomeoneElse={allowForOthers}
            codeToReceiver={forOthers?.send_code_to_receiver !== false}
            showErrors={showDetailErrors}
          />
        ) : (
          <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0 }]}>
            <Pressable onPress={() => setInstr((v) => !v)}>
              <Row icon={<PenGlyph white />} label={COPY.instructions} right={<ChevronIcon size={16} color={INK} stroke={2.2} />} h={48} />
            </Pressable>
            <Collapsible open={instr}>
              <InstructionChips on={notes} setOn={setNotes} />
            </Collapsible>
          </Animated.View>
        )}

        {/* bill */}
        {/* coupons: only while Admin has them switched on (checkout-info) */}
        {!DEMO && checkout && quoteFor?.coupons_enabled && (
          <CouponCard coupon={coupon} error={couponErr} onApply={applyCoupon} onRemove={() => { setCoupon(null); setCouponErr(null); }} />
        )}

        {/* referral reward, Use points, points to earn: only what applies */}
        {!DEMO && checkout && quoteFor && (
          <RewardsCard
            referral={referralOf(quoteFor)}
            points={pointsOf(quoteFor)}
            usePoints={usePoints}
            onUsePoints={setUsePoints}
            redeem={checkout.points}
            earn={checkout.earn}
          />
        )}

        {!DEMO ? <LiveBillCard bill={live} itemTotal={total} mrpTotal={mrpTotal} checkout={checkout} coupon={coupon} freeCount={quoteFor?.free_delivery?.count ?? 0} payMethod={payMethod} /> : (
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

        {/* payment: cash on delivery or PayHere (only while staff have it on), with the policy links */}
        {!DEMO && checkout && onlineOffered(payInfo) && (
          <PaymentChoice info={payInfo} toPay={checkout.toPay} method={payMethod} onChange={setPayChoice} />
        )}

        {/* where we deliver (owner, 2026-10-14: show the surroundings when they order) */}
        {!DEMO && (
          <CoverageCard
            coverage={coverageOf(store)}
            pin={addr ? { lat: addr.latitude, lng: addr.longitude } : loc.guestPin}
            style={{ marginHorizontal: 15, marginBottom: 15 }}
          />
        )}

        <Text style={styles.policyTitle}>{COPY.policyTitle}</Text>
        <Text style={styles.policy}>{DEMO ? COPY.policy : LIVE.policy}</Text>
        {!DEMO && !(checkout && onlineOffered(payInfo)) && <PolicyRow style={{ marginHorizontal: 23, marginTop: 8 }} />}
      </Animated.ScrollView>

      <FeeHeader
        topInset={insets.top}
        burstKey={burst}
        backRow={(
          <View style={styles.backRow}>
            <PressScale onPress={goBack} style={{ padding: 2 }}><BackIcon size={20} color={TEXT} stroke={1.8} /></PressScale>
            <Text style={[styles.backTitle, { flex: 1 }]} numberOfLines={1}>{DEMO ? COPY.storeName : LIVE.storeTitle(store)}</Text>
            {/* Clear cart (Flutter ClearCartSheet): in the header, asks first */}
            <Pressable onPress={() => setConfirmClear(true)} hitSlop={8} accessibilityRole="button" style={styles.clearBtn}>
              <Text style={styles.clearTxt}>{CLEAR_CART.button}</Text>
            </Pressable>
          </View>
        )}
      />

      {/* bottom action panel: login → address → (local) place order */}
      <View style={[styles.bottom, { paddingBottom: bottomPad }]}>
        {!phone ? (
          <Animated.View key="login" exiting={FadeOut.duration(150)}>
            <Text style={styles.bottomTitle}>{COPY.almost}</Text>
            <Text style={styles.bottomSub}>{COPY.almostSub}</Text>
            <PressScale onPress={() => (midRegistration ? router.push('/register') : setLogin(true))} haptic style={{ marginTop: 24 }} scaleTo={0.95}>
              <View style={styles.cta}><Text style={styles.ctaTxt}>{COPY.proceedPhone}</Text></View>
            </PressScale>
          </Animated.View>
        ) : !DEMO ? (
          <LiveCheckoutPanel
            loc={loc}
            checkout={checkout}
            quoteFailed={quoteFailed}
            onRetryQuote={() => setQuoteTick((n) => n + 1)}
            closedNow={closedNow}
            orderable={orderable}
            closedHint={lead.days > 0 && !lead.blocked ? (pickedSlot ? SLOT_COPY.slotPickedHint : LEAD_COPY.pickSlot(lead.dateLabel))
              : !closedNow || !slotsOn ? null : pickedSlot ? SLOT_COPY.slotPickedHint : SLOT_COPY.pickSlotHint}
            blockedLabel={lead.blocked ? LEAD_COPY.blockedCta : lead.days > 0 ? LEAD_COPY.pickCta : null}
            canOrder={hasLines}
            payMethod={payMethod}
            placing={placing}
            error={placeErr}
            onPlace={place}
          />
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
            {/* design mock: nothing is ordered */}
            <PressScale onPress={() => setNotice(Date.now())} disabled={count === 0} haptic style={{ marginTop: 21 }} scaleTo={0.95}>
              <View style={styles.cta}><Text style={styles.ctaTxt}>Place order  |  {rupee(toPay)}</Text></View>
            </PressScale>
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
      {confirmClear && (
        <Sheet label={CLEAR_CART.title} onClose={() => setConfirmClear(false)}>
          <Text style={A.sheetTitle}>{CLEAR_CART.title}</Text>
          <Text style={A.body}>{CLEAR_CART.message}</Text>
          <View style={A.pair}>
            <SheetButton label={CLEAR_CART.cancel} kind="secondary" onPress={() => setConfirmClear(false)} style={{ flex: 1 }} />
            <SheetButton label={CLEAR_CART.confirm} kind="danger" onPress={() => { setConfirmClear(false); cartActions.clear(); }} style={{ flex: 1 }} />
          </View>
        </Sheet>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */

/** Black-outlined "−  1  +" pill used on the cart lines (60 × 26). */
function Stepper({ product, qty, variant }: { product: Product; qty: number; variant?: CartLine['variant'] }) {
  const { add, remove } = cartActions;
  // a size line steps that size only
  const key = keyOf({ product, variant });
  return (
    <View style={styles.stepper}>
      <Pressable hitSlop={6} onPress={() => { tap(); remove(key); }} style={styles.stepBtn}><Text style={styles.stepSign}>-</Text></Pressable>
      <Animated.Text key={qty} entering={FadeIn.duration(150)} style={styles.stepQty}>{qty}</Animated.Text>
      <Pressable hitSlop={6} onPress={() => { tap(); add(product, variant); }} style={styles.stepBtn}><Text style={styles.stepSign}>+</Text></Pressable>
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

/** Delivery instructions; live, the chosen ones go to the rider as the order's delivery note. */
function InstructionChips({ on, setOn }: { on: string[]; setOn: (f: (s: string[]) => string[]) => void }) {
  const opts = ['Leave at door', 'Avoid calling', "Don't ring bell", 'Pet at home'];
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
    <PressScale haptic onPress={() => (hasVariants(product) ? openSizePicker(product) : cartActions.add(product))} style={[styles.mealPlus, q > 0 && { backgroundColor: C.brand, borderColor: C.brandDeep }]} scaleTo={0.85}>
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

/**
 * One cart line at Blynk's effective LKR price (a size at its own price, its label under the
 * name); an unavailable line ("Sold out", or a size to pick again) is flagged with a Remove button.
 */
function LiveLine({ line, showSavings }: { line: CartLine; showSavings: boolean }) {
  const { product: p, quantity: qty, variant } = line;
  const ok = lineAvailable(line);
  const priced = linePriced(line);
  // the struck regular price shows only while Admin's show_offer_savings is on
  const offer = showSavings && ok && isOfferActive(priced);
  const why = needsVariant(line) ? VARIANT_COPY.pickSizeAgain : variant || p.is_available === false ? VARIANT_COPY.soldOut : LIVE.unavailable;
  return (
    <Animated.View exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={[styles.itemRow, variant && { height: undefined, minHeight: 50, paddingVertical: 6 }]}>
      <ProductImage product={p} size={30} radius={6} style={!ok && { opacity: 0.45 }} />
      <View style={{ flex: 1, marginLeft: 6 }}>
        <Text style={[styles.itemName, { marginLeft: 0 }, !ok && { color: '#8A8A90' }]} numberOfLines={1}>{p.name}</Text>
        {!!variant && <Text style={styles.variantLabel} numberOfLines={1}>{variant.label}</Text>}
        {!ok && <Text style={styles.unavail}>{why}</Text>}
      </View>
      {ok ? (
        <Stepper product={p} qty={qty} variant={variant} />
      ) : (
        <PressScale onPress={() => cartActions.setQty(p, 0, variant)} style={styles.removeBtn}><Text style={styles.removeTxt}>{LIVE.remove}</Text></PressScale>
      )}
      <View style={[styles.priceCol, { width: 78 }]}>
        {offer && <Text style={styles.itemStrike}>{formatLkr(round2(priced.selling_price * qty))}</Text>}
        {ok && <Text style={[styles.itemPrice, { fontSize: 13 }]}>{formatLkr(round2(lineUnitPrice(line) * qty))}</Text>}
      </View>
    </Animated.View>
  );
}

/** The cart's size lines: each of those products re-read (GET /catalog/products/:id) for its sizes' price and stock. */
function refreshVariantLines(lines: CartLine[]) {
  const ids = [...new Set(lines.filter((l) => l.variant && !l.product.id.startsWith('demo-')).map((l) => l.product.id))].slice(0, 20);
  for (const id of ids) {
    fetchProductDetail(id)
      .then((d) => { rememberDetail(d.product); cartActions.syncVariants(d.product); })
      .catch(() => undefined);
  }
}

/** Fresh combo packs (GET /combos) for the combo lines in the cart: price, items, sold out. */
function refreshCombos() {
  getCombos().then((r) => cartActions.syncCombos(Array.isArray(r?.combos) ? r.combos : [])).catch(() => undefined);
}

/** One combo pack line: its picture, name, what one pack holds, a stepper and packs x price. */
function ComboCartLine({ line }: { line: ComboLine }) {
  const c = line.combo;
  return (
    <Animated.View exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={[styles.itemRow, { height: undefined, minHeight: 56, paddingVertical: 8 }]}>
      <View style={!c.is_available && { opacity: 0.45 }}><ComboThumb combo={c} size={30} radius={6} /></View>
      <View style={{ flex: 1, marginLeft: 6, marginRight: 6 }}>
        <Text style={[styles.itemName, { marginLeft: 0 }, !c.is_available && { color: '#8A8A90' }]} numberOfLines={1}>{c.name}</Text>
        <Text style={styles.comboInside} numberOfLines={2}>Combo pack · {comboSummary(c)}</Text>
        {!c.is_available && <Text style={styles.unavail}>{LIVE.unavailable}</Text>}
      </View>
      {c.is_available ? (
        <ComboAdd combo={c} compact />
      ) : (
        <PressScale onPress={() => cartActions.setComboQty(c, 0)} style={styles.removeBtn}><Text style={styles.removeTxt}>{LIVE.remove}</Text></PressScale>
      )}
      <View style={[styles.priceCol, { width: 78 }]}>
        {c.is_available && comboHasSaving(c) && <Text style={styles.itemStrike}>{formatLkr(round2(c.items_total * line.quantity))}</Text>}
        {c.is_available && <Text style={[styles.itemPrice, { fontSize: 13 }]}>{formatLkr(round2(c.price * line.quantity))}</Text>}
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
            <Text style={[styles.mealPrice, isOfferActive(p) && { color: C.brandText }]} numberOfLines={1}>{hasVariants(p) ? priceText(p, { compact: true }) : formatLkr(effectivePrice(p))}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The bill with Blynk's own numbers: item total (struck regular total only when offer savings
 * are switched on and an offer is active), the delivery fee, the true "no packaging or platform
 * fee" line, and To Pay. Signed in with an address, the fee is the server's quote for that
 * address (GET /orders/checkout-info: free deliveries, the basket amount, per-km distance);
 * otherwise it is what /store says. No taxes or invented savings.
 */
function LiveBillCard({ bill, itemTotal, mrpTotal, checkout, coupon, freeCount, payMethod }: {
  bill: LiveBill; itemTotal: number; mrpTotal: number; checkout: CheckoutBill | null; coupon: CouponPreview | null;
  payMethod: PayMethod;
  /** New-customer free deliveries in all (checkout-info free_delivery.count). */
  freeCount: number;
}) {
  const quoted = !!checkout && checkout.deliveryFee !== null;
  const free = quoted ? checkout!.freeReason !== null : bill.freeCount > 0;
  const toPay = quoted ? (checkout!.toPay as number) : bill.toPay;
  const feeKnown = quoted || bill.feeKnown;
  // the header counts every saving: offer prices (while shown), the coupon / birthday / referral discount and points
  const head = savingsHeader({
    offerSaved: bill.saved, showOfferSavings: bill.showSaved, discount: checkout?.discount ?? 0, pointsValue: checkout?.points.value ?? 0, toPay,
  });
  const distance = quoted && checkout!.distanceKm != null ? ` · ${checkout!.distanceEstimated ? '~' : ''}${checkout!.distanceKm.toFixed(1)} km` : '';
  const feeRight = !checkout ? (
    <Text style={[styles.billR, free && { color: C.brandText }]}>{bill.feeText}</Text>
  ) : !quoted ? (
    <Text style={[styles.billR, { color: '#8A8A90' }]}>Calculating…</Text>
  ) : free ? (
    <Text style={styles.billR}>
      {checkout.standardFee ? <Text style={styles.billStrike}>{formatLkr(checkout.standardFee)} </Text> : null}
      <Text style={{ color: C.brandText }}>FREE</Text>
    </Text>
  ) : (
    <Text style={styles.billR}>{formatLkr(checkout.deliveryFee as number)}</Text>
  );
  const freeNote = !checkout
    ? (free ? LIVE.freeNote(bill.freeCount) : null)
    : freeDeliveryNote(checkout, freeCount);
  // the one discount used (coupon, birthday gift or referral reward), then the points
  const discountName = checkout ? discountLabel(checkout.discountKind, coupon?.code) : '';
  const estimated = !!checkout && !coupon && checkout.discount > 0;
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0, overflow: 'hidden' }]}>
      {free && <StampBadge variant="free" size={70} style={{ position: 'absolute', right: -2, top: -2 }} />}
      <View style={styles.billHead}>
        <View style={styles.sq}><ReceiptGlyph /></View>
        <View>
          <Text style={styles.payLine}>
            To Pay {head.show && <Text style={styles.payStrike}>{formatLkr(head.before)} </Text>}{formatLkr(toPay)}
          </Text>
          <Text style={[styles.savedTxt, !head.show && { color: '#6E6E76' }]}>
            {head.show ? `${formatLkr(head.saved)} saved on the total!` : feeKnown ? 'Includes the delivery fee' : 'Delivery fee confirmed at checkout'}
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
        <BillRow dashed l={`Delivery Fee${distance}`} r={feeRight} />
        {!!freeNote && <Text style={styles.freeNote}>{freeNote}</Text>}
        {checkout?.basketRemaining != null && (
          <View accessible accessibilityLabel={basketPrompt(checkout.basketRemaining)} style={{ marginTop: 8 }}>
            <Text style={[styles.freeNote, { marginTop: 0, color: C.brandText, fontFamily: F.medium }]}>{basketPrompt(checkout.basketRemaining)}</Text>
            <View style={styles.progressTrack}>
              <Animated.View layout={LinearTransition.duration(260)} style={[styles.progressFill, { width: `${Math.round(basketProgress(itemTotal, checkout.basketMin) * 100)}%` }]} />
            </View>
          </View>
        )}
        {!!checkout && checkout.discount > 0 && (
          <>
            <Dashed style={{ marginVertical: 11 }} />
            <BillRow l={discountName} r={<Text style={[styles.billR, { color: C.brandText }]}>−{formatLkr(checkout.discount)}</Text>} />
          </>
        )}
        {!!checkout && checkout.points.value > 0 && (
          <>
            <Dashed style={{ marginVertical: 11 }} />
            <BillRow l={`Blynk Points (${checkout.points.points})`} r={<Text style={[styles.billR, { color: C.brandText }]}>−{formatLkr(checkout.points.value)}</Text>} />
          </>
        )}
        {!!checkout && (estimated || checkout.points.value > 0) && (
          <Text style={styles.freeNote}>Estimated. The final amount is confirmed when you place the order.</Text>
        )}
      </View>
      <Animated.View entering={FadeIn.duration(250)} style={styles.thatsIt}>
        <LinearGradient colors={[C.brandTint, 'rgba(255,248,214,0)']} start={{ x: 0.55, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        <Text style={styles.thatsItTxt}>{LIVE.thatsIt}</Text>
      </Animated.View>
      <View style={[styles.billRow, { paddingHorizontal: 15, height: 46 }]}>
        <Text style={styles.payTotal}>To Pay</Text>
        <Text style={styles.payTotal}>{formatLkr(toPay)}{feeKnown ? '' : ' + delivery'}</Text>
      </View>
      {!!checkout && (
        <View style={[styles.billRow, { paddingHorizontal: 15, paddingBottom: 14, marginTop: -6 }]}>
          <Text style={[styles.billL, { lineHeight: 18 }]}>Payment</Text>
          <Text style={[styles.billR, { fontFamily: F.medium }]}>{payMethod === 'ONLINE' ? PAY.online : PAY.cod}</Text>
        </View>
      )}
    </Animated.View>
  );
}

/** "Apply a coupon": shown only while checkout-info says coupons are on. The order re-checks the code. */
function CouponCard({ coupon, error, onApply, onRemove }: {
  coupon: CouponPreview | null; error: string | null; onApply: (code: string) => Promise<void>; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = normalizeCoupon(code);
  const valid = clean.length > 0;
  const apply = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await onApply(clean);
    setBusy(false);
  };
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, { paddingHorizontal: 0 }]}>
      {coupon ? (
        <View>
          <Row icon={<TagGlyph />} label={`${coupon.code} applied`} right={(
            <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove coupon ${coupon.code}`}><Text style={styles.change}>Remove</Text></Pressable>
          )} />
          <Text style={[styles.couponNote, couponAppliedNote(coupon).muted && { color: '#6E6E76' }]}>{couponAppliedNote(coupon).text}</Text>
        </View>
      ) : (
        <Pressable onPress={() => setOpen((v) => !v)}>
          <Row icon={<TagGlyph />} label="Have a coupon code?" right={<ChevronIcon size={16} color={INK} stroke={2.2} />} />
        </Pressable>
      )}
      <Collapsible open={open && !coupon}>
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 15, paddingBottom: 12 }}>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.replace(/[^A-Za-z0-9]/g, '').slice(0, 20))}
            onSubmitEditing={apply}
            autoCapitalize="characters"
            placeholder="Enter coupon code"
            placeholderTextColor="#9A9AA2"
            accessibilityLabel="Coupon code"
            style={styles.couponInput}
          />
          <PressScale disabled={!valid || busy} onPress={apply} style={[styles.couponBtn, (!valid || busy) && { backgroundColor: C.brandSoft }]}>
            <Text style={styles.couponBtnTxt}>{busy ? 'Checking…' : 'Apply'}</Text>
          </PressScale>
        </View>
      </Collapsible>
      {!!error && <Text style={[styles.warn, { marginHorizontal: 16, marginTop: -4 }]} accessibilityRole="alert">{error}</Text>}
    </Animated.View>
  );
}

/**
 * The signed-in bottom panel: where the order goes (the address book's chosen address, with
 * Change), then "Place order" for the server-quoted total. Refusals show here with their copy.
 */
function LiveCheckoutPanel({ loc, checkout, quoteFailed, onRetryQuote, closedNow, orderable, closedHint, blockedLabel, canOrder, payMethod, placing, error, onPlace }: {
  loc: DeliveryLocation; checkout: CheckoutBill | null; quoteFailed: boolean; onRetryQuote: () => void; closedNow: boolean;
  /** Open for ASAP, or a picked delivery slot with room (a closed store can still take a slot). */
  orderable: boolean;
  /** While closed with slots on: "Pick a delivery time above…" / "We'll deliver at the time you picked." */
  closedHint: string | null;
  /** The button's words while the cart can't go now for a lead time (pick a slot / remove the item). */
  blockedLabel?: string | null;
  canOrder: boolean; payMethod: PayMethod; placing: boolean; error: PlaceErrorCopy | null; onPlace: () => void;
}) {
  const a = loc.address;
  if (loc.syncing || (!a && loc.loading)) {
    return (
      <Animated.View key="saving" entering={FadeIn.duration(200)} style={{ paddingBottom: 6 }}>
        <View style={styles.whereRow}>
          <View style={{ marginTop: 3 }}><NavIcon size={16} color={C.brandInk} /></View>
          <Text style={styles.whereTxt}>{loc.syncing ? 'Saving your address…' : 'Loading your addresses…'}</Text>
        </View>
        <View style={[styles.cta, { marginTop: 21, backgroundColor: C.brandSoft }]}><Text style={styles.ctaTxt}>Please wait…</Text></View>
      </Animated.View>
    );
  }
  if (!a) {
    const sync = loc.syncError;
    return (
      <Animated.View key="addr" entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
        {sync && (
          <ErrorBox
            title={sync.outOfArea ? OUTSIDE_AREA.title : "We couldn't save your address"}
            message={sync.outOfArea ? OUTSIDE_AREA.message : sync.message}
          />
        )}
        <View style={styles.whereRow}>
          <View style={{ marginTop: 3 }}><NavIcon size={16} color={C.brandInk} /></View>
          <Text style={styles.whereTxt}>{COPY.whereTitle}</Text>
        </View>
        <PressScale onPress={() => router.push('/address?return=/cart')} haptic style={{ marginTop: 21 }} scaleTo={0.95}>
          <View style={styles.cta}><Text style={styles.ctaTxt}>{COPY.addAddress}</Text></View>
        </PressScale>
      </Animated.View>
    );
  }
  const toPay = checkout?.toPay ?? null;
  const disabled = !canOrder || !orderable || placing || toPay === null;
  const label = !orderable ? (blockedLabel ?? (closedNow && closedHint ? 'Pick a delivery time' : LIVE.closedCta))
    : placing ? 'Placing your order…'
      : toPay === null ? (quoteFailed ? 'Delivery fee unavailable' : 'Getting the delivery fee…')
        : payMethod === 'ONLINE' ? PAY.placeOnline(formatLkr(toPay)) : PAY.placeCod(formatLkr(toPay));
  return (
    <Animated.View key="place" entering={FadeIn.duration(200)}>
      {error && (
        <ErrorBox title={error.title} message={error.message} action={error.action === 'address' ? (
          <Pressable onPress={() => router.push('/addresses?return=/cart')} hitSlop={8}><Text style={styles.change}>Choose another address</Text></Pressable>
        ) : undefined} />
      )}
      <View style={styles.whereRow}>
        <View style={{ marginTop: 3 }}><NavIcon size={16} color={C.brandInk} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.whereTxt, { marginLeft: 0 }]} numberOfLines={1}>Deliver to {a.label}</Text>
          <Text style={styles.bottomSub} numberOfLines={1}>{addressSummary(a)}</Text>
        </View>
        <Pressable onPress={() => router.push('/addresses?return=/cart')} hitSlop={8}><Text style={styles.change}>Change</Text></Pressable>
      </View>
      {quoteFailed && toPay === null && (
        <Pressable onPress={onRetryQuote} hitSlop={6}>
          <Text style={[styles.warn, { marginHorizontal: 0, marginTop: 10, marginBottom: 0 }]}>{"Couldn't get the delivery fee. Tap to try again."}</Text>
        </Pressable>
      )}
      {!!closedHint && <Text style={[styles.bottomSub, { marginTop: 10, color: C.brandText, fontFamily: F.medium }]}>{closedHint}</Text>}
      <PressScale onPress={onPlace} disabled={disabled} haptic style={{ marginTop: 21 }} scaleTo={0.95}>
        <View style={[styles.cta, disabled && { backgroundColor: C.brandSoft }]} accessibilityRole="button" accessibilityLabel={label}>
          <Text style={styles.ctaTxt}>{label}</Text>
        </View>
      </PressScale>
    </Animated.View>
  );
}

function ErrorBox({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.errBox} accessibilityRole="alert">
      <Text style={styles.errTitle}>{title}</Text>
      <Text style={styles.errMsg}>{message}</Text>
      {action ? <View style={{ marginTop: 6 }}>{action}</View> : null}
    </Animated.View>
  );
}

/**
 * Login bottom sheet: floating "Mobile Number" label; Continue lights up at 10 digits (live: +94
 * and a valid 9-digit Sri Lankan mobile). Live: Continue asks Blynk to SMS a code
 * (POST /auth/otp/request); its errors show in the sheet.
 */
function LoginSheet({ onClose }: { onClose: () => void }) {
  const [num, setNum] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // live: Sri Lankan mobiles, 9 digits after +94 (a leading 0 is dropped)
  const e164 = DEMO ? null : toE164(num);
  const ready = DEMO ? /^\d{10}$/.test(num) : num.length === LIVE.phoneDigits && !!e164;
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
    if (DEMO) {
      Keyboard.dismiss();
      onClose();
      router.push({ pathname: '/otp', params: { phone: num } });
      return;
    }
    if (!e164 || sending) return;
    setSending(true);
    setError(null);
    requestOtp(e164)
      .then((r) => {
        setPendingOtp(e164, r.dev_otp);
        Keyboard.dismiss();
        onClose();
        router.push({ pathname: '/otp', params: { phone: e164 } });
      })
      .catch((e) => setError(authErrorText(e)))
      .finally(() => setSending(false));
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
              onChangeText={(t) => {
                setNum(DEMO ? t.replace(/\D/g, '').slice(0, 10) : t.replace(/\D/g, '').replace(/^0/, '').slice(0, LIVE.phoneDigits));
                setError(null);
              }}
              onSubmitEditing={() => ready && submit()}
              keyboardType="number-pad"
              style={styles.phoneInput}
              maxLength={10}
              accessibilityLabel={COPY.mobileLabel}
            />
          </View>
        </Pressable>
        {!!error && <Text style={styles.sheetErr} accessibilityRole="alert">{error}</Text>}
        <PressScale disabled={!ready || sending} onPress={submit} haptic scaleTo={0.96}>
          <Animated.View style={[styles.cta, btn]}><Text style={[styles.ctaTxt, { fontSize: 14.5 }]}>{sending ? LIVE.sending : COPY.continue}</Text></Animated.View>
        </PressScale>
        <Text style={styles.terms}>
          By clicking, I accept the <Text style={styles.link} onPress={DEMO ? undefined : () => openPolicy('privacy')} accessibilityRole="link">privacy policy</Text> and <Text style={styles.link} onPress={DEMO ? undefined : () => openPolicy('terms')} accessibilityRole="link">terms of use</Text>
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
  clearBtn: { paddingHorizontal: 14, height: 38, justifyContent: 'center' },
  clearTxt: { fontFamily: F.semi, color: C.problem, fontSize: 12.5 },
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
  sheetErr: { fontFamily: F.medium, fontSize: 12, color: C.problem, lineHeight: 16, marginTop: -18, marginBottom: 12 },
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
  comboInside: { fontFamily: F.regular, fontSize: 11, color: '#8A8A90', marginTop: 1, lineHeight: 14 },
  unavail: { fontFamily: F.semi, fontSize: 11, color: C.problem, marginTop: 1 },
  variantLabel: { fontFamily: F.medium, fontSize: 11.5, color: C.sub, marginTop: 1 },
  removeBtn: { height: 26, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1.2, borderColor: C.problem, justifyContent: 'center' },
  removeTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.problem },
  errBox: { backgroundColor: '#FDF1EF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14, borderWidth: 1, borderColor: '#F3D2CC' },
  errTitle: { fontFamily: F.semi, fontSize: 13.5, color: C.problem },
  errMsg: { fontFamily: F.regular, fontSize: 12.2, color: TEXT, marginTop: 2, lineHeight: 17 },
  couponInput: {
    flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: '#E4E4EA', paddingHorizontal: 12,
    fontFamily: F.medium, fontSize: 13.5, color: INK, letterSpacing: 0.5, outlineStyle: 'none',
  } as object,
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: LINE, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: C.green },
  couponNote: { fontFamily: F.medium, fontSize: 12, color: C.green, marginLeft: 45, marginTop: -10, marginBottom: 12 },
  couponBtn: { height: 40, borderRadius: 10, paddingHorizontal: 16, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  couponBtnTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
});
