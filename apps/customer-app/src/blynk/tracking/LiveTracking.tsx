import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { TrackingMap } from './TrackingMap';
import { useLiveTracking } from './useLiveTracking';

/*
 * "Live tracking" for an order that is OUT_FOR_DELIVERY (Flutter's OrderTrackingMap): the map
 * with the rider and the road route, a status pill ("Live" / "Last seen 45 seconds ago" /
 * "Live location unavailable right now."), "<Rider> is on the way" and "Arriving in ~N min"
 * (only for a LIVE rider with a server route), and "Full map" (the /track/[id] screen).
 *
 * Mount it only while order.order_status === 'OUT_FOR_DELIVERY' (see isTrackable): unmounting
 * closes the stream. It needs the order's delivery point (order.delivery_latitude/longitude,
 * sent by GET /orders/:id); without one it renders nothing.
 */

export const MAP_SECTION_TITLE = 'Live tracking';

export type LatLngLike = { lat: number | string | null | undefined; lng: number | string | null | undefined };

/** The order's delivery point as numbers, or null when it has none. */
export function destinationOf(d: LatLngLike | null | undefined): { lat: number; lng: number } | null {
  if (!d) return null;
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  if (d.lat === null || d.lat === undefined || d.lng === null || d.lng === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Only an order on the road is tracked. */
export const isTrackable = (o: { order_status?: string | null } | null | undefined) => o?.order_status === 'OUT_FOR_DELIVERY';

/** "Kamal is on the way" / "Your rider is on the way". */
export const onTheWayText = (name?: string | null) => `${(name ?? '').trim() || 'Your rider'} is on the way`;

export function LiveTracking({
  orderId, destination, riderName, mapHeight = 220, full = false, onOpenFull,
}: {
  orderId: string;
  /** order.delivery_latitude / order.delivery_longitude. */
  destination: LatLngLike | null | undefined;
  /** order.rider_contact?.first_name */
  riderName?: string | null;
  mapHeight?: number;
  /** The full-screen variant (the /track/[id] route): no title, no "Full map" link. */
  full?: boolean;
  /** Defaults to opening /track/[id]. */
  onOpenFull?: () => void;
}) {
  const dest = destinationOf(destination);
  const t = useLiveTracking(dest ? orderId : null);
  if (!dest) return null;
  const open = onOpenFull ?? (() => router.push({ pathname: '/track/[id]', params: { id: orderId } }));

  return (
    <Animated.View entering={FadeIn.duration(200)} style={full ? styles.fullWrap : styles.card}>
      {!full && (
        <View style={styles.head}>
          <Text style={styles.title}>{MAP_SECTION_TITLE}</Text>
          <PressScale onPress={open} style={styles.fullBtn} scaleTo={0.94}>
            <Text style={styles.fullTxt}>Full map</Text>
          </PressScale>
        </View>
      )}
      <View style={full ? { flex: 1 } : styles.mapFrame}>
        <TrackingMap
          destination={dest}
          rider={t.rider}
          stale={t.freshness === 'stale'}
          heading={t.heading}
          route={t.route}
          height={full ? '100%' : mapHeight}
        />
      </View>
      <View style={[styles.below, full && styles.belowFull]}>
        <View style={styles.pill} accessibilityLiveRegion="polite">
          <View style={[styles.dot, { backgroundColor: t.caption.live ? C.green : '#C9CAD3' }]} />
          <Text style={t.caption.live ? styles.liveTxt : styles.capTxt}>{t.caption.text}</Text>
        </View>
        {(t.riderVisible || !!riderName) && !t.closed && (
          <Text style={styles.onWay}>{onTheWayText(riderName)}</Text>
        )}
        {!!t.eta && <Text style={styles.eta}>{t.eta}</Text>}
        {t.closed && <Text style={styles.capTxt}>Your order is no longer on the road.</Text>}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  fullWrap: { flex: 1, backgroundColor: '#fff' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingTop: 13, paddingBottom: 10 },
  title: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  fullBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandDeep },
  fullTxt: { fontFamily: F.semi, fontSize: 12, color: C.brandInk },
  mapFrame: { marginHorizontal: 0 },
  below: { paddingHorizontal: 15, paddingTop: 10, paddingBottom: 14, gap: 6 },
  belowFull: { paddingBottom: 22 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  liveTxt: { fontFamily: F.semi, fontSize: 12, color: C.greenDark },
  capTxt: { fontFamily: F.regular, fontSize: 12, color: C.sub },
  onWay: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  eta: { fontFamily: F.bold, fontSize: 16, color: C.brandText },
});
