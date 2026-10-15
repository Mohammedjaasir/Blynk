import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { formatLkr } from '@/blynk/lib/money';
import { listOrders } from '@/blynk/orders/api';
import { setKnownOrders } from '@/blynk/orders/openOrders';
import { placeErrorCopy } from '@/blynk/orders/errors';
import { itemCountText, orderTime, statusLabel, statusTone, type OrderTone } from '@/blynk/orders/status';
import type { Order } from '@/blynk/orders/types';
import { openSignIn } from '@/blynk/ui/signIn';
import { ChevronIcon } from '@/components/icons';
import { OfflineBanner } from '@/components/OfflineBanner';
import { PressScale, Skeleton } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * My orders: GET /orders (this customer's, newest first), refreshed whenever the screen comes
 * into focus. Each row opens the order status screen. Design mock: a preview note, no network.
 */

const TONE: Record<OrderTone, string> = { active: C.brandText, success: C.green, neutral: C.sub, problem: C.problem };

export default function Orders() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const gen = useRef(0);

  const load = useCallback(() => {
    if (DEMO || !signedIn) return;
    const g = ++gen.current;
    setError(null);
    listOrders(1)
      .then((r) => {
        if (g !== gen.current) return;
        setOrders(r.orders);
        // the Orders tab's badge (an order still open)
        setKnownOrders(r.orders);
        setPage(1);
        setPages(r.pagination.total_pages);
      })
      .catch((e) => { if (g === gen.current) setError(placeErrorCopy(e).message); });
  }, [signedIn]);

  useFocusEffect(load);

  const loadMore = () => {
    if (more || page >= pages) return;
    setMore(true);
    const g = gen.current;
    listOrders(page + 1)
      .then((r) => {
        if (g !== gen.current) return;
        const seen = new Set((orders ?? []).map((o) => o.id));
        setOrders([...(orders ?? []), ...r.orders.filter((o) => !seen.has(o.id))]);
        setPage(r.pagination.page);
        setPages(r.pagination.total_pages);
      })
      .catch((e) => setError(placeErrorCopy(e).message))
      .finally(() => setMore(false));
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      {/* a tab of the shell: no back button */}
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title} accessibilityRole="header">My orders</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }}>
        {signedIn && !DEMO && <OfflineBanner onRetry={load} style={{ marginBottom: 12 }} />}
        {DEMO ? (
          <Empty title="Your orders appear here" sub="Ordering opens soon. This is a preview." />
        ) : !signedIn ? (
          <Empty title="Log in to see your orders" sub="Your past and current orders appear here." cta="Log in" onPress={openSignIn} />
        ) : error && !orders ? (
          <Empty title="Couldn't load your orders" sub={error} cta="Try again" onPress={load} />
        ) : !orders ? (
          [0, 1, 2].map((i) => <Skeleton key={i} h={92} r={16} style={{ marginBottom: 12 }} />)
        ) : orders.length === 0 ? (
          <Empty title="No orders yet" sub="Everything you order appears here, with its status." cta="Start shopping" to="/home" />
        ) : (
          <>
            {orders.map((o, i) => <OrderRow key={o.id} order={o} index={i} />)}
            {!!error && <Text style={styles.err}>{error}</Text>}
            {page < pages && (
              <PressScale onPress={loadMore} disabled={more} style={styles.more}>
                <Text style={styles.moreTxt}>{more ? 'Loading…' : 'Show older orders'}</Text>
              </PressScale>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function OrderRow({ order: o, index }: { order: Order; index: number }) {
  const tone = TONE[statusTone(o.order_status)];
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 40).duration(220)}>
      <PressScale onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })} style={styles.card} scaleTo={0.98}>
        <View style={{ flex: 1 }}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text style={[styles.status, { color: tone }]}>{statusLabel(o.order_status)}</Text>
          </View>
          <Text style={styles.num}>{o.order_number}</Text>
          <Text style={styles.meta}>{[orderTime(o.placed_at ?? o.created_at), itemCountText(o)].filter(Boolean).join('  ·  ')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          {/* the order's value: what is left to pay plus what the Blynk Wallet paid (a wallet-paid order is not "LKR 0") */}
          <Text style={styles.total}>{formatLkr(o.total_amount + (o.wallet_amount_used ?? 0))}</Text>
          <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View>
        </View>
      </PressScale>
    </Animated.View>
  );
}

function Empty({ title, sub, cta, to, onPress }: { title: string; sub: string; cta?: string; to?: '/home' | '/cart'; onPress?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.empty}>
      <Text style={{ fontSize: 54 }}>🧾</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
      {!!cta && (
        <PressScale onPress={onPress ?? (() => (to === '/home' ? router.dismissTo('/home') : router.push(to ?? '/home')))} style={styles.cta} haptic>
          <Text style={styles.ctaTxt}>{cta}</Text>
        </PressScale>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 17, paddingBottom: 12, backgroundColor: '#fff' },
  title: { fontFamily: F.bold, fontSize: 18, color: C.ink },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 15, marginBottom: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontFamily: F.semi, fontSize: 13 },
  num: { fontFamily: F.semi, fontSize: 14.5, color: C.ink, marginTop: 5 },
  meta: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 3 },
  total: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  err: { fontFamily: F.medium, fontSize: 12.5, color: C.problem, textAlign: 'center', marginVertical: 8 },
  more: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  moreTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.brandText },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 20 },
  emptyTitle: { fontFamily: F.bold, fontSize: 18, color: C.ink, marginTop: 12, textAlign: 'center' },
  emptySub: { fontFamily: F.regular, fontSize: 13.5, color: C.sub, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  cta: { marginTop: 20, height: 46, borderRadius: 23, paddingHorizontal: 28, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
});
