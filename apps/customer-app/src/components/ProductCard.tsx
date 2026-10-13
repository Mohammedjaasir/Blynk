import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import type { Product } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive } from '@/blynk/lib/pricing';
import { useStore } from '@/blynk/store/StoreContext';
import { withSpring } from '@/lib/motion';
import { useCartSelect } from '@/lib/cart';
import { C, F } from '@/lib/theme';
import { ProductImage } from './ProductImage';
import { AddButton, PriceTicker } from './ui';

export const unitText = (p: Pick<Product, 'unit' | 'pack_size'>) => [p.unit, p.pack_size].filter(Boolean).join(' · ');

/** Square product tile used on Home rails, aisle cards and the aisle grid. */
export const ProductCard = memo(function ProductCard({
  product: p, width = 128, sub, index = 0,
}: { product: Product; width?: number; sub?: string; index?: number }) {
  const inCart = useCartSelect((c) => (c.qty[p.id] ?? 0) > 0);
  const showSavings = useStore()?.show_offer_savings === true;
  const offer = isOfferActive(p);
  const pop = useSharedValue(0.6);
  useEffect(() => {
    // the photo pops in as if it just finished loading
    pop.value = withDelay(120 + index * 70, withSpring(1, { damping: 11, stiffness: 160 }));
  }, []);
  const ea = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: pop.value }));
  return (
    <View style={{ width }}>
      <View style={[styles.img, { width, height: width }]}>
        <Animated.View style={[ea, !p.is_available && { opacity: 0.45 }]}>
          <ProductImage product={p} size={width} style={{ backgroundColor: 'transparent' }} />
        </Animated.View>
        <View style={styles.addWrap}>
          {p.is_available ? (
            <AddButton product={p} compact />
          ) : (
            <View style={styles.soldOut}><Text style={styles.soldOutTxt}>Out of stock</Text></View>
          )}
        </View>
      </View>
      {sub && <Text style={styles.sub} numberOfLines={1}>{sub}</Text>}
      <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
      {!!unitText(p) && <Text style={styles.unit} numberOfLines={1}>{unitText(p)}</Text>}
      <View style={styles.priceRow}>
        {offer && <Text style={styles.mrp}>{formatLkr(p.selling_price)}</Text>}
        <Text style={[styles.price, offer && { color: C.pink }]}>{formatLkr(effectivePrice(p))}</Text>
      </View>
      <PriceTicker product={p} showSavings={showSavings} forceSave={inCart} />
    </View>
  );
});

export function ProductCardEntering({ children, index }: { children: React.ReactNode; index: number }) {
  return <Animated.View entering={FadeIn.delay(index * 60).duration(350)}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  img: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'visible', backgroundColor: C.tile },
  addWrap: { position: 'absolute', right: 6, bottom: 6 },
  soldOut: { backgroundColor: C.white, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: C.line },
  soldOutTxt: { fontSize: 9.5, color: C.sub, fontFamily: F.semi },
  sub: { fontSize: 10, color: C.faint, fontFamily: F.regular, marginTop: 6 },
  name: { fontSize: 12, fontFamily: F.semi, color: C.ink, lineHeight: 15, marginTop: 6 },
  unit: { fontSize: 10, color: C.sub, fontFamily: F.regular, marginTop: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 3, flexWrap: 'wrap' },
  mrp: { fontSize: 10.5, color: C.faint, textDecorationLine: 'line-through', fontFamily: F.regular },
  price: { fontSize: 12.5, color: C.ink, fontFamily: F.bold },
});
