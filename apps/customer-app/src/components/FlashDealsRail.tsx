import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTrackList } from '@/blynk/analytics/AnalyticsHost';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { useClockValue } from '@/blynk/promo/clock';
import { flashCandidates, flashRail, flashRailKey } from '@/blynk/promo/flashDeals';
import { DEMO } from '@/demo/mode';
import { C, SPACE, T } from '@/lib/theme';
import { BoltIcon, FlashPill } from './FlashPill';
import { ProductCard } from './ProductCard';

const CARD_W = 155; // as the other Home rails

/**
 * Home's automatic "Flash deals" rail: every orderable product whose offer ends within 24 h, soonest first,
 * with the header counting down to the nearest end. Goes by itself when the last deal ends; hidden when
 * there are none. Reads the catalogue itself, so Home mounts it with one line.
 */
export function FlashDealsRail({ style }: { style?: StyleProp<ViewStyle> }) {
  const { data } = useCatalog();
  const candidates = useMemo(() => flashCandidates(data?.products), [data]);
  // the rail is worked out again only when its list changes (a deal starts counting or ends)
  const key = useClockValue((t) => flashRailKey(candidates, t), candidates.length > 0);
  const rail = useMemo(() => flashRail(candidates, Date.now()), [candidates, key]);
  useTrackList(rail.products.length ? 'Home: Flash deals' : null, rail.products);
  if (DEMO || rail.products.length === 0 || rail.nearestEndMs === null) return null;
  return (
    <View style={style}>
      <View style={s.railHead}>
        <View style={s.titleRow}>
          <View style={s.badge}><BoltIcon size={14} /></View>
          <Text style={[T.section, { flexShrink: 1 }]} numberOfLines={1} accessibilityRole="header">Flash deals</Text>
        </View>
        <FlashPill endsAtMs={rail.nearestEndMs} size="head" style={{ marginTop: 4 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {rail.products.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} width={CARD_W} sub={p.category_name} />
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  railHead: { paddingHorizontal: SPACE.gutter, marginTop: SPACE.section, marginBottom: SPACE.head },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  rail: { paddingHorizontal: SPACE.gutter, gap: 15 },
});
