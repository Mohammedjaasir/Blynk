import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useCartSelect } from '@/lib/cart';
import { PRODUCTS } from '@/lib/data';
import { C, F } from '@/lib/theme';
import { VegMark } from './icons';
import { AddButton, SavingsTicker } from './ui';

/** Square product tile used on Home rails, store cards and the store grid. */
export const ProductCard = memo(function ProductCard({
  id, storeId, width = 128, sub, showRating = true, index = 0,
}: { id: string; storeId?: string; width?: number; sub?: string; showRating?: boolean; index?: number }) {
  const p = PRODUCTS[id];
  const inCart = useCartSelect((c) => (c.qty[id] ?? 0) > 0);
  const pct = Math.round((1 - p.price / p.otherMin) * 100);
  const discounted = p.mrp > p.price;
  const emoji = useSharedValue(0.6);
  useEffect(() => {
    // emoji "image" pops in as if it just finished loading
    emoji.value = withDelay(120 + index * 70, withSpring(1, { damping: 11, stiffness: 160 }));
  }, []);
  const ea = useAnimatedStyle(() => ({ transform: [{ scale: emoji.value }], opacity: emoji.value }));
  return (
    <View style={{ width }}>
      <View style={[styles.img, { width, height: width, backgroundColor: p.bg }]}>
        <Animated.Text style={[{ fontSize: width * 0.48 }, ea]}>{p.emoji}</Animated.Text>
        {p.popular && (
          <View style={styles.popular}>
            <Text style={styles.popularTxt}>Popular</Text>
          </View>
        )}
        <View style={styles.addWrap}>
          <AddButton id={id} storeId={storeId} compact />
        </View>
      </View>
      {showRating && (
        <Text style={styles.rating}>
          <Text style={{ color: C.green }}>★</Text> {p.rating.toFixed(1)}
        </Text>
      )}
      {sub && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}
      <View style={styles.nameRow}>
        <VegMark color={p.organic ? C.green : '#C0392B'} size={10} />
        <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
      </View>
      <Text style={styles.unit}>{p.unit}</Text>
      <View style={styles.priceRow}>
        {discounted && <Text style={styles.mrp}>₹{p.mrp}</Text>}
        <Text style={[styles.price, discounted && { color: C.pink }]}>₹{p.price}</Text>
      </View>
      <SavingsTicker otherMin={p.otherMin} otherMax={p.otherMax} pct={pct} forceOurs={inCart} />
    </View>
  );
});

export function ProductCardEntering({ children, index }: { children: React.ReactNode; index: number }) {
  return <Animated.View entering={FadeIn.delay(index * 60).duration(350)}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  img: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  popular: {
    position: 'absolute', top: 7, left: 7, backgroundColor: C.white, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#B6E3C0',
  },
  popularTxt: { fontSize: 9.5, color: C.green, fontFamily: F.semi },
  addWrap: { position: 'absolute', right: 6, bottom: 6 },
  rating: { fontSize: 10.5, fontFamily: F.semi, color: C.text, marginTop: 6 },
  sub: { fontSize: 10, color: C.faint, fontFamily: F.regular, marginTop: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 3 },
  name: { flex: 1, fontSize: 12, fontFamily: F.semi, color: C.ink, lineHeight: 15 },
  unit: { fontSize: 10, color: C.sub, fontFamily: F.regular, marginTop: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 3 },
  mrp: { fontSize: 10.5, color: C.faint, textDecorationLine: 'line-through', fontFamily: F.regular },
  price: { fontSize: 12.5, color: C.ink, fontFamily: F.bold },
});
