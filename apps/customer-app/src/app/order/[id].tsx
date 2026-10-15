import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showNotice } from '@/blynk/account/notice';
import { getCombos } from '@/blynk/api/catalog';
import { ApiError } from '@/blynk/api/client';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { fetchProductDetail } from '@/blynk/catalog/product';
import { formatLkr } from '@/blynk/lib/money';
import { appHidden, onVisible } from '@/blynk/lib/visibility';
import { cancelOrder, getOrder } from '@/blynk/orders/api';
import { cancelErrorText, placeErrorCopy } from '@/blynk/orders/errors';
import {
  awaitingPayment, CODE_COMING, discountRows, payByLine, isOpenOrder, itemCaption, itemTitle, mayCancel, orderTime, paymentLine, progressOf, PROGRESS_STEPS,
  riderArrived, showsDeliveryCode, showsDeliveryCodeComing, slotWindowText, statusLabel, statusSentence, statusTone,
  timelineLabel, type OrderTone,
} from '@/blynk/orders/status';
import { canReorder, reorderInto, reorderMessage } from '@/blynk/orders/reorder';
import { PAY } from '@/blynk/payments/copy';
import type { Order } from '@/blynk/orders/types';
import { LiveTracking, isTrackable } from '@/blynk/tracking';
import { openSignIn } from '@/blynk/ui/signIn';
import { WALLET_COPY } from '@/blynk/wallet/copy';
import { refundNotice } from '@/blynk/wallet/models';
import { BackIcon } from '@/components/icons';
import { PressScale, Skeleton } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { cartActions, getCartSnapshot } from '@/lib/cart';
import { C, F } from '@/lib/theme';

/*
 * Order status: GET /orders/:id, polled every 12 s while the screen is visible and the order is
 * still moving. The status, a four-step tracker, the delivery code and the rider's first name
 * and phone while it is on the road (the server sends them only then), "What happened", the
 * items, the bill and the address. "Cancel order" only while the server says can_cancel.
 * Blynk Wallet: "Paid by wallet" in the bill and the refunds credited back to the wallet; after a
 * cancel that refunded something, "Refund of LKR X added to your Blynk Wallet".
 */

const POLL_MS = 12_000;
const TONE: Record<OrderTone, string> = { active: C.brandText, success: C.green, neutral: C.sub, problem: C.problem };

export default function OrderStatus() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<{ text: string; missing: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const status = order?.order_status ?? null;
  const busy = useRef(false);

  const load = useCallback(() => {
    if (DEMO || !signedIn || !id || busy.current) return;
    busy.current = true;
    getOrder(id)
      .then((o) => { setOrder(o); setError(null); })
      .catch((e) => {
        const missing = e instanceof ApiError && (e.status === 404 || e.status === 400);
        setError({ text: missing ? 'This order could not be found.' : placeErrorCopy(e).message, missing });
      })
      .finally(() => { busy.current = false; });
  }, [id, signedIn]);

  useEffect(load, [load]);

  // poll while visible and the order is still moving; catch up when the app comes back
  useEffect(() => {
    if (DEMO || !signedIn || (status && !isOpenOrder(status))) return;
    const t = setInterval(() => { if (!appHidden()) load(); }, POLL_MS);
    const off = onVisible(load);
    return () => { clearInterval(t); off(); };
  }, [load, status]);

  const cancelRef = useRef(false);
  const doCancel = () => {
    // a double tap sends one cancel
    if (!order || cancelRef.current) return;
    cancelRef.current = true;
    setCancelling(true);
    setCancelMsg(null);
    cancelOrder(order.id)
      .then((o) => {
        setOrder({ ...order, ...o, history: o.history ?? order.history });
        setConfirm(false);
        // money back goes to the Blynk Wallet (docs/api/wallet.md §3)
        const refund = refundNotice(o.wallet);
        if (refund) showNotice(refund);
        load();
      })
      .catch((e) => { setCancelMsg(cancelErrorText(e)); setConfirm(false); load(); })
      .finally(() => { cancelRef.current = false; setCancelling(false); });
  };

  // "Order again" (Flutter OrderAgainButton): today's prices, gone items named, then the cart
  const [reordering, setReordering] = useState(false);
  const orderAgain = async () => {
    if (!order || reordering) return;
    setReordering(true);
    try {
      const r = await reorderInto(order, {
        fetchProduct: (pid) => fetchProductDetail(pid).then((d) => d.product),
        fetchCombos: () => getCombos().then((x) => x.combos ?? []),
        comboQty: (cid) => getCartSnapshot().comboQty[cid] ?? 0,
        addCombo: cartActions.addCombo,
        addProduct: (p, n, v) => {
          // per line: the product, or one size of it (migration 045)
          const key = v ? `${p.id}:${v.id}` : p.id;
          const before = getCartSnapshot().lineQty[key] ?? 0;
          cartActions.setQty(p, before + n, v);
          return (getCartSnapshot().lineQty[key] ?? 0) - before;
        },
      });
      const m = reorderMessage(r);
      showNotice(m.text, m.ok ? 'info' : 'problem');
      if (m.ok) router.push('/cart');
    } finally {
      setReordering(false);
    }
  };

  const title = order?.order_number ?? 'Order';
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <PressScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/orders'))} style={{ padding: 4 }}>
          <BackIcon size={20} color={C.text} stroke={1.8} />
        </PressScale>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!order && <Text style={styles.headSub}>{orderTime(order.placed_at ?? order.created_at)}</Text>}
        </View>
        {!DEMO && signedIn && (
          <Pressable onPress={() => router.push('/orders')} hitSlop={8}><Text style={styles.link}>My orders</Text></Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }}>
        {DEMO ? (
          <Note title="Order status appears here" sub="Ordering opens soon. This is a preview." />
        ) : !signedIn ? (
          <Note title="Log in to see this order" sub="Your orders appear here once you are signed in." cta="Log in" onPress={openSignIn} />
        ) : !order && error ? (
          <Note title={error.missing ? 'Order not found' : "Couldn't load this order"} sub={error.text} cta={error.missing ? undefined : 'Try again'} onPress={load} />
        ) : !order ? (
          <>
            <Skeleton h={150} r={16} style={{ marginBottom: 12 }} />
            <Skeleton h={120} r={16} style={{ marginBottom: 12 }} />
            <Skeleton h={180} r={16} />
          </>
        ) : (
          <Animated.View entering={FadeIn.duration(200)}>
            <StatusCard order={order} />
            {/* an online order waiting for its PayHere payment: pay by the expiry time */}
            {awaitingPayment(order) && (
              <View style={[styles.card, styles.payCard]}>
                <Text style={styles.payHead}>{payByLine(order)}</Text>
                <Text style={[styles.small, { marginTop: 2 }]}>{order.payment_status === 'FAILED' ? PAY.failedSub('') : `${formatLkr(order.total_amount)} · ${PAY.online}`}</Text>
                <PressScale onPress={() => router.push({ pathname: '/payment/pay', params: { order: order.id } } as never)} style={styles.payBtn} haptic>
                  <Text style={styles.payBtnTxt}>{PAY.payNow}</Text>
                </PressScale>
              </View>
            )}
            {showsDeliveryCode(order) ? (
              <View style={[styles.card, styles.codeCard]} accessible accessibilityLabel={`Your delivery code: ${order.delivery_code}. Show this to your rider.`}>
                <Text style={styles.codeLabel}>Your delivery code</Text>
                <Text style={styles.code}>{order.delivery_code}</Text>
                <Text style={styles.codeSub}>Show this to your rider.</Text>
              </View>
            ) : showsDeliveryCodeComing(order) ? (
              <View style={[styles.card, styles.comingCard]}>
                <Text style={styles.small}>{CODE_COMING}</Text>
              </View>
            ) : null}
            {!!order.rider_contact && (
              <View style={[styles.card, styles.riderRow]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.small}>{riderArrived(order) ? 'At your door' : 'Your rider'}</Text>
                  <Text style={styles.strong}>{(order.rider_contact.first_name ?? 'Your rider') + (riderArrived(order) ? ' has arrived' : '')}</Text>
                </View>
                <PressScale onPress={() => Linking.openURL(`tel:${order.rider_contact!.phone}`)} style={styles.callBtn} haptic>
                  <Text style={styles.callTxt}>Call rider</Text>
                </PressScale>
              </View>
            )}
            {isTrackable(order) && (
              <LiveTracking
                orderId={order.id}
                destination={{ lat: order.delivery_latitude, lng: order.delivery_longitude }}
                riderName={order.rider_contact?.first_name}
              />
            )}
            {!!error && <Text style={styles.stale}>{error.text}</Text>}

            {!!order.history?.length && (
              <View style={styles.card}>
                <Text style={styles.section}>What happened</Text>
                {order.history.map((h, i) => (
                  <View key={h.id} style={styles.tlRow}>
                    <View style={styles.tlRail}>
                      <View style={[styles.tlDot, i === order.history!.length - 1 && { backgroundColor: C.brand, borderColor: C.brandDeep }]} />
                      {i < order.history!.length - 1 && <View style={styles.tlLine} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 12 }}>
                      <Text style={styles.tlLabel}>{timelineLabel(h)}</Text>
                      <Text style={styles.small}>{orderTime(h.created_at)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.card}>
              <Text style={styles.section}>Items</Text>
              {/* combo packs first, each with its products under it (Flutter order summary); then loose items */}
              {(order.combos ?? []).map((c) => (
                <View key={c.id} style={styles.comboBlock}>
                  <View style={styles.itemRow}>
                    <Text style={[styles.itemName, { fontFamily: F.semi }]} numberOfLines={2}>
                      {c.quantity > 1 ? `${c.name} × ${c.quantity}` : c.name}
                    </Text>
                    <Text style={styles.price}>{formatLkr(c.subtotal)}</Text>
                  </View>
                  <Text style={[styles.small, { marginTop: -4, marginBottom: 2 }]}>Combo pack</Text>
                  {order.items.filter((it) => it.order_combo_id === c.id).map((it) => (
                    <View key={it.id} style={[styles.itemRow, { paddingVertical: 3 }]}>
                      <Text style={[styles.itemName, styles.comboItem, itemCaption(it.item_status)?.struck && styles.struck]} numberOfLines={2}>
                        {itemTitle(it.product_name_snapshot, it.unit_snapshot)}
                      </Text>
                      <Text style={styles.qty}>× {it.quantity}</Text>
                    </View>
                  ))}
                </View>
              ))}
              {order.items.filter((it) => !it.order_combo_id).map((it) => {
                // an UNAVAILABLE line is out of the totals (struck, shown for the record); a SUBSTITUTED one was replaced
                const cap = itemCaption(it.item_status);
                return (
                  <View key={it.id} style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemName, cap?.struck && styles.struck]} numberOfLines={2}>
                        {itemTitle(it.product_name_snapshot, it.unit_snapshot)}
                      </Text>
                      {!!cap && <Text style={[styles.small, { fontSize: 11.5 }, cap.problem && { color: C.problem }]}>{cap.text}</Text>}
                    </View>
                    <Text style={styles.qty}>× {it.quantity}</Text>
                    <Text style={[styles.price, cap?.struck && styles.struck]}>{formatLkr(it.subtotal)}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Bill</Text>
              <BillLine l="Item total" r={formatLkr(order.subtotal_amount)} />
              <BillLine l="Delivery fee" r={order.delivery_fee === 0 ? 'FREE' : formatLkr(order.delivery_fee)} accent={order.delivery_fee === 0} />
              {discountRows(order).map((d) => <BillLine key={d.label} l={d.label} r={`−${formatLkr(d.amount)}`} accent />)}
              {order.wallet_amount_used > 0 && <BillLine l={WALLET_COPY.orderBillLine} r={`−${formatLkr(order.wallet_amount_used)}`} accent />}
              <View style={styles.sep} />
              <BillLine l="Total" r={formatLkr(order.total_amount)} bold />
              <Text style={[styles.small, { marginTop: 6 }]}>{paymentLine(order)}</Text>
              {/* refunds credited to the Blynk Wallet for this order, newest first */}
              {!!order.wallet?.entries.length && (
                <View style={styles.refunds}>
                  <Text style={[styles.section, { marginBottom: 6 }]}>{WALLET_COPY.refundsTitle}</Text>
                  {order.wallet.entries.map((e) => (
                    <View key={e.id} style={{ paddingVertical: 4 }}>
                      <Text style={styles.refundTxt}>{WALLET_COPY.refundAdded(e.amount)}</Text>
                      <Text style={styles.small}>{[e.reason, e.createdAt ? orderTime(e.createdAt.toISOString()) : null].filter(Boolean).join(' · ')}</Text>
                    </View>
                  ))}
                  <Pressable onPress={() => router.push('/wallet')} hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                    <Text style={styles.link}>{WALLET_COPY.viewWallet}</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.section}>Delivering to</Text>
              {!!slotWindowText(order.scheduled_for, order.scheduled_until) && (
                <Text style={[styles.body, { marginTop: 0, marginBottom: 6 }]}>Delivery time: <Text style={{ fontFamily: F.semi }}>{slotWindowText(order.scheduled_for, order.scheduled_until)}</Text></Text>
              )}
              {order.ordered_for_someone_else === true && <Text style={[styles.small, { marginBottom: 2 }]}>For someone else</Text>}
              {!!order.delivery_recipient_name && (
                <Text style={styles.strong}>{order.delivery_recipient_name}{order.delivery_recipient_phone ? `  ·  ${order.delivery_recipient_phone}` : ''}</Text>
              )}
              <Text style={styles.body}>{[order.delivery_address_line1, order.delivery_address_line2, order.delivery_city].filter(Boolean).join(', ')}</Text>
              {!!order.delivery_instructions && <Text style={[styles.small, { marginTop: 4 }]}>Note: {order.delivery_instructions}</Text>}
              {order.delivery_needs_help === true && <Text style={[styles.small, { marginTop: 4 }]}>Needs help at the door</Text>}
            </View>

            {canReorder(order) && (
              <PressScale onPress={() => void orderAgain()} disabled={reordering} style={[styles.keepBtn, { marginBottom: 12 }]} haptic>
                <Text style={styles.keepTxt}>{reordering ? 'Adding…' : 'Order again'}</Text>
              </PressScale>
            )}

            {(mayCancel(order) || cancelMsg) && (
              <Animated.View layout={LinearTransition.duration(200)} style={styles.card}>
                {!!cancelMsg && <Text style={[styles.stale, { marginTop: 0, marginBottom: 8 }]}>{cancelMsg}</Text>}
                {mayCancel(order) && (
                  <>
                    <Text style={styles.small}>You can cancel until your order is out for delivery.</Text>
                    <PressScale onPress={() => setConfirm(true)} style={styles.cancelBtn}>
                      <Text style={styles.cancelTxt}>Cancel order</Text>
                    </PressScale>
                  </>
                )}
              </Animated.View>
            )}
          </Animated.View>
        )}
      </ScrollView>

      {confirm && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !cancelling && setConfirm(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} accessibilityRole="alert">
            <Text style={styles.sheetTitle}>Cancel this order?</Text>
            <Text style={styles.body}>{"This can't be undone."}</Text>
            <PressScale onPress={() => setConfirm(false)} disabled={cancelling} style={[styles.keepBtn, { marginTop: 18 }]}>
              <Text style={styles.keepTxt}>Keep order</Text>
            </PressScale>
            <PressScale onPress={doCancel} disabled={cancelling} style={[styles.cancelBtn, { alignSelf: 'stretch', marginTop: 10 }]}>
              <Text style={styles.cancelTxt}>{cancelling ? 'Cancelling…' : 'Cancel order'}</Text>
            </PressScale>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function StatusCard({ order }: { order: Order }) {
  const tone = TONE[statusTone(order.order_status)];
  const { step, stopped } = progressOf(order.order_status);
  return (
    <View style={styles.card}>
      <Text style={[styles.statusTitle, { color: tone }]}>{statusLabel(order.order_status)}</Text>
      <Text style={styles.body}>{statusSentence(order)}</Text>
      {!(stopped && order.order_status === 'CANCELLED') && (
        <View style={styles.track} accessibilityLabel={`Order progress: ${PROGRESS_STEPS[step]}${stopped ? ', stopped' : ''}`}>
          {PROGRESS_STEPS.map((label, i) => {
            const done = i <= step;
            return (
              <View key={label} style={{ flex: 1, alignItems: 'center' }}>
                <View style={styles.trackRow}>
                  <View style={[styles.trackBar, { opacity: i === 0 ? 0 : 1 }, i <= step && styles.trackOn]} />
                  <View style={[styles.trackDot, done && styles.trackDotOn, stopped && i === step && { backgroundColor: C.problem, borderColor: C.problem }]} />
                  <View style={[styles.trackBar, { opacity: i === PROGRESS_STEPS.length - 1 ? 0 : 1 }, i < step && styles.trackOn]} />
                </View>
                <Text style={[styles.trackLabel, done && { color: C.ink, fontFamily: F.semi }]} numberOfLines={1}>{label}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function BillLine({ l, r, bold, accent }: { l: string; r: string; bold?: boolean; accent?: boolean }) {
  return (
    <View style={styles.billLine}>
      <Text style={[styles.billL, bold && styles.billBold]}>{l}</Text>
      <Text style={[styles.billR, bold && styles.billBold, accent && { color: C.brandText }]}>{r}</Text>
    </View>
  );
}

function Note({ title, sub, cta, onPress }: { title: string; sub: string; cta?: string; onPress?: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 80, paddingHorizontal: 20 }}>
      <Text style={{ fontSize: 54 }}>🧾</Text>
      <Text style={styles.noteTitle}>{title}</Text>
      <Text style={[styles.body, { textAlign: 'center', marginTop: 6 }]}>{sub}</Text>
      {!!cta && (
        <PressScale onPress={onPress} style={[styles.keepBtn, { marginTop: 20, paddingHorizontal: 28 }]} haptic>
          <Text style={styles.keepTxt}>{cta}</Text>
        </PressScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 12, backgroundColor: '#fff' },
  title: { fontFamily: F.bold, fontSize: 17, color: C.ink },
  headSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 1 },
  link: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 15, marginBottom: 12 },
  statusTitle: { fontFamily: F.bold, fontSize: 21, letterSpacing: -0.3 },
  body: { fontFamily: F.regular, fontSize: 13.5, color: C.text, marginTop: 3, lineHeight: 19 },
  small: { fontFamily: F.regular, fontSize: 12, color: C.sub, lineHeight: 17 },
  strong: { fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 2 },
  section: { fontFamily: F.semi, fontSize: 12, color: '#7A7A82', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 },
  track: { flexDirection: 'row', marginTop: 18 },
  trackRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  trackBar: { flex: 1, height: 3, backgroundColor: '#E6E6EB' },
  trackOn: { backgroundColor: C.brandDeep },
  trackDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#D5D5DC', backgroundColor: '#fff' },
  trackDotOn: { backgroundColor: C.brand, borderColor: C.brandDeep },
  trackLabel: { fontFamily: F.regular, fontSize: 11, color: C.sub, marginTop: 6 },
  codeCard: { alignItems: 'center', backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandSoft },
  comingCard: { backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandSoft },
  codeLabel: { fontFamily: F.semi, fontSize: 13, color: C.brandInk },
  code: { fontFamily: F.black, fontSize: 34, letterSpacing: 8, color: C.brandInk, marginTop: 4 },
  codeSub: { fontFamily: F.regular, fontSize: 12, color: C.text, marginTop: 2 },
  riderRow: { flexDirection: 'row', alignItems: 'center' },
  callBtn: { height: 38, borderRadius: 19, paddingHorizontal: 16, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  callTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
  stale: { fontFamily: F.medium, fontSize: 12, color: C.problem, marginBottom: 10, marginHorizontal: 4 },
  tlRow: { flexDirection: 'row', gap: 10 },
  tlRail: { width: 14, alignItems: 'center' },
  tlDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#D5D5DC', backgroundColor: '#fff', marginTop: 3 },
  tlLine: { flex: 1, width: 2, backgroundColor: '#E6E6EB', marginTop: 2 },
  tlLabel: { fontFamily: F.semi, fontSize: 13.5, color: C.ink },
  comboBlock: { borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 6, marginBottom: 4 },
  comboItem: { fontFamily: F.regular, fontSize: 12.5, color: C.text, paddingLeft: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, gap: 8 },
  itemName: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.ink },
  qty: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, width: 34, textAlign: 'right' },
  price: { fontFamily: F.regular, fontSize: 13, color: C.ink, width: 86, textAlign: 'right' },
  struck: { textDecorationLine: 'line-through', color: C.faint },
  billLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  billL: { fontFamily: F.regular, fontSize: 13, color: '#5E5E66' },
  billR: { fontFamily: F.regular, fontSize: 13, color: C.ink },
  billBold: { fontFamily: F.bold, fontSize: 14.5, color: C.ink },
  sep: { height: 1, backgroundColor: C.line, marginVertical: 8 },
  refunds: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 12, paddingTop: 12 },
  refundTxt: { fontFamily: F.semi, fontSize: 13, color: C.greenDark },
  payCard: { backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandSoft },
  payHead: { fontFamily: F.bold, fontSize: 15.5, color: C.ink },
  payBtn: { marginTop: 12, height: 46, borderRadius: 23, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  payBtnTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  cancelBtn: { marginTop: 10, height: 44, borderRadius: 22, borderWidth: 1.4, borderColor: C.problem, alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { fontFamily: F.semi, fontSize: 14, color: C.problem },
  keepBtn: { height: 46, borderRadius: 23, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  keepTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', zIndex: 50 },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20 },
  sheetTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink },
  noteTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, marginTop: 12, textAlign: 'center' },
});
