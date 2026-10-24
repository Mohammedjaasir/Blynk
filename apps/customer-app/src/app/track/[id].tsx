import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@/blynk/api/client';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { getOrder } from '@/blynk/orders/api';
import { statusLabel } from '@/blynk/orders/status';
import type { Order } from '@/blynk/orders/types';
import { isTrackable, LiveTracking } from '@/blynk/tracking';
import { DeliveredRating } from '@/blynk/ratings/RatingCard';
import { openSignIn } from '@/blynk/ui/signIn';
import { BackIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * The full-screen tracking map (Flutter's "Full map"): the order's live rider, route and ETA over
 * the whole screen, with the order number and "Call rider" in a card. GET /orders/:id is re-read
 * every 20 s so the screen notices when the order is delivered; it then offers the order.
 */
const POLL_MS = 20_000;

type Tracked = Order & { delivery_latitude?: number | string | null; delivery_longitude?: number | string | null };

export default function TrackOrder() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [order, setOrder] = useState<Tracked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(() => {
    if (DEMO || !signedIn || !id || busy.current) return;
    busy.current = true;
    getOrder(id)
      .then((o) => { setOrder(o as Tracked); setError(null); })
      .catch((e) => setError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'This order could not be found.' : (e as Error).message))
      .finally(() => { busy.current = false; });
  }, [id, signedIn]);

  useEffect(load, [load]);
  useEffect(() => {
    if (!order || !isTrackable(order)) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [order?.order_status, load]);

  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/order/[id]', params: { id } }));

  let body: React.ReactNode;
  if (DEMO) body = <Note text="Live tracking works in the live app." />;
  else if (!signedIn) body = <Note text="Log in to track your order." cta="Log in" onRetry={openSignIn} />;
  else if (error && !order) body = <Note text={error} onRetry={load} />;
  else if (!order) body = <View style={styles.center}><ActivityIndicator color={C.brandInk} /></View>;
  else if (!isTrackable(order)) {
    // delivered: "Delivered" with the rating card (migration 055), else the note
    body = (
      <DeliveredRating order={order} top={insets.top} onViewOrder={() => router.replace({ pathname: '/order/[id]', params: { id } })} fallback={(
      <Note
        text={`This order is ${statusLabel(order.order_status).toLowerCase()}. Live tracking shows while it is out for delivery.`}
        cta="View order"
        onRetry={() => router.replace({ pathname: '/order/[id]', params: { id } })}
      />
      )} />
    );
  } else {
    body = (
      <LiveTracking
        full
        orderId={order.id}
        destination={{ lat: order.delivery_latitude, lng: order.delivery_longitude }}
        riderName={order.rider_contact?.first_name}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>{body}</View>
      <View style={[styles.top, { top: insets.top + 10 }]} pointerEvents="box-none">
        <PressScale onPress={back} style={styles.back}><BackIcon size={20} color={C.ink} stroke={1.9} /></PressScale>
        {!!order && (
          <View style={styles.badge}>
            <Text style={styles.badgeTxt}>Order {order.order_number}</Text>
          </View>
        )}
      </View>
      {!!order?.rider_contact?.phone && isTrackable(order) && (
        <View style={[styles.callWrap, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <PressScale onPress={() => Linking.openURL(`tel:${order.rider_contact!.phone}`)} style={styles.call} haptic>
            <Text style={styles.callTxt}>Call rider</Text>
          </PressScale>
        </View>
      )}
    </View>
  );
}

function Note({ text, cta = 'Try again', onRetry }: { text: string; cta?: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.note}>{text}</Text>
      {!!onRetry && (
        <PressScale onPress={onRetry} style={styles.btn}><Text style={styles.btnTxt}>{cta}</Text></PressScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  note: { fontFamily: F.medium, fontSize: 14, color: C.sub, textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 16, height: 44, paddingHorizontal: 24, borderRadius: 22, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontFamily: F.semi, fontSize: 14, color: C.brandInk },
  top: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  badge: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.line },
  badgeTxt: { fontFamily: F.semi, fontSize: 13, color: C.ink },
  callWrap: { position: 'absolute', right: 16 },
  call: { height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.brandDeep },
  callTxt: { fontFamily: F.semi, fontSize: 14, color: C.brandInk },
});
