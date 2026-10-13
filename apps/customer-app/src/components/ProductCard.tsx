import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import type { Product } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive } from '@/blynk/lib/pricing';
import { useStore } from '@/blynk/store/StoreContext';
import { extraOf } from '@/demo/extras';
import { DEMO } from '@/demo/mode';
import { rupees } from '@/demo/money';
import { withSpring } from '@/lib/motion';
import { useCartSelect } from '@/lib/cart';
import { C, F } from '@/lib/theme';
import { NonVegMark, StarIcon, VegMark } from './icons';
import { ProductImage } from './ProductImage';
import { AddButton, DemoTicker, PriceTicker } from './ui';

export const unitText = (p: Pick<Product, 'unit' | 'pack_size'>) => [p.unit, p.pack_size].filter(Boolean).join(' · ');
const money = (n: number) => (DEMO ? rupees(n) : formatLkr(n));

/**
 * Dish tile, measured off the reference: photo slot (square on Home's "Meals under ₹99"
 * rail, 134 × 100 inside a store card) with a "Popular" tag, a ★ rating tab and the "+"
 * that opens into "− 1 +"; then the restaurant line, veg mark + name, the price (offer
 * price in a tinted pill) and the "Other apps / Our app" footer.
 * In the design mock the photo is an emoji stand-in on a neutral tile.
 */
export const ProductCard = memo(function ProductCard({
  product: p, width = 128, height, sub, index = 0, showRating = true, seen = true,
}: {
  product: Product; width?: number; height?: number; sub?: string; index?: number;
  /** The ★ tab on the photo (Home's rail shows it, store cards don't). */
  showRating?: boolean;
  /** The footer rolls to "Our app: n% lower" a moment after this turns true. */
  seen?: boolean;
}) {
  const inCart = useCartSelect((c) => (c.qty[p.id] ?? 0) > 0);
  const showSavings = useStore()?.show_offer_savings === true;
  const offer = isOfferActive(p);
  const x = extraOf(p.id);
  const h = height ?? width;
  const wide = h < width * 0.85; // a store card's 134 x 100 row photo, not a (near-)square tile
  const pop = useSharedValue(0.6);
  useEffect(() => {
    // the photo pops in as if it just finished loading
    pop.value = withDelay(120 + index * 70, withSpring(1, { damping: 11, stiffness: 160 }));
  }, []);
  const ea = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: pop.value }));
  const line = sub ?? (wide ? undefined : x?.store);
  return (
    <View style={{ width }}>
      <View style={[styles.img, { width, height: h, borderRadius: wide ? 10 : 14 }]}>
        <Animated.View style={[ea, !p.is_available && { opacity: 0.45 }]}>
          {x?.emoji ? (
            <Text style={{ fontSize: Math.round(h * 0.5), lineHeight: Math.round(h * 0.62) }}>{x.emoji}</Text>
          ) : (
            <ProductImage product={p} size={Math.min(width, h)} style={{ backgroundColor: 'transparent' }} />
          )}
        </Animated.View>
        {x?.popular && (
          <View style={styles.popular}><Text style={styles.popularTxt}>Popular</Text></View>
        )}
        {showRating && x?.rating != null && (
          <View style={styles.rating}>
            <StarIcon size={10} color={C.brandInk} />
            <Text style={styles.ratingTxt}>{x.rating.toFixed(1)}</Text>
          </View>
        )}
        <View style={[styles.addWrap, wide && { right: 8, bottom: 6 }]}>
          {p.is_available ? (
            <AddButton product={p} big />
          ) : (
            <View style={styles.soldOut}><Text style={styles.soldOutTxt}>Out of stock</Text></View>
          )}
        </View>
      </View>
      {!!line && <Text style={styles.sub} numberOfLines={1}>{line}</Text>}
      <View style={[styles.nameRow, !line && { marginTop: 9 }]}>
        {x?.veg != null && (
          <View style={styles.mark}>{x.veg ? <VegMark size={11} color={C.veg} /> : <NonVegMark size={11} />}</View>
        )}
        <Text style={styles.name} numberOfLines={2}>{x?.veg != null ? '     ' : ''}{p.name}</Text>
      </View>
      {!x && !!unitText(p) && <Text style={styles.unit} numberOfLines={1}>{unitText(p)}</Text>}
      <View style={styles.priceRow}>
        {offer ? (
          <>
            {/* live: the struck regular price only while Admin's show_offer_savings is on (as in the cart) */}
            {(DEMO || showSavings) && <Text style={styles.mrp}>{money(p.selling_price)}</Text>}
            <View style={styles.pill}><Text style={styles.pillTxt}>{money(effectivePrice(p))}</Text></View>
          </>
        ) : (
          <Text style={styles.price}>{money(effectivePrice(p))}</Text>
        )}
      </View>
      {x ? (
        <DemoTicker other={x.other} lowerPct={x.lowerPct} seen={seen} forceSave={inCart} money={money} delay={1400 + Math.min(index, 4) * 140} />
      ) : (
        <PriceTicker product={p} showSavings={showSavings} forceSave={inCart} />
      )}
    </View>
  );
});

export function ProductCardEntering({ children, index }: { children: React.ReactNode; index: number }) {
  return <Animated.View entering={FadeIn.delay(index * 60).duration(350)}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  img: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.tile },
  popular: { position: 'absolute', left: 6, top: 6, backgroundColor: C.brandSoft, borderRadius: 9, paddingHorizontal: 6, height: 19, justifyContent: 'center' },
  popularTxt: { fontFamily: F.semi, fontSize: 11, color: C.brandInk },
  rating: {
    position: 'absolute', left: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: C.white, borderTopRightRadius: 9, paddingLeft: 3, paddingRight: 5, height: 18,
  },
  ratingTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.text },
  addWrap: { position: 'absolute', right: 8, bottom: 8 },
  soldOut: { backgroundColor: C.white, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: C.line },
  soldOutTxt: { fontSize: 9.5, color: C.sub, fontFamily: F.semi },
  sub: { fontSize: 11.5, color: '#8A8A90', fontFamily: F.regular, marginTop: 8 },
  nameRow: { marginTop: 1 },
  mark: { position: 'absolute', left: 0, top: 3 },
  name: { fontSize: 13.5, fontFamily: F.medium, color: '#1E1E24', lineHeight: 17 },
  unit: { fontSize: 10, color: C.sub, fontFamily: F.regular, marginTop: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, minHeight: 20 },
  mrp: { fontSize: 13, color: '#9A9AA0', textDecorationLine: 'line-through', fontFamily: F.regular },
  pill: { backgroundColor: C.brandSoft, borderRadius: 9, paddingHorizontal: 5, height: 20, justifyContent: 'center' },
  pillTxt: { fontSize: 13.5, color: C.brandInk, fontFamily: F.semi },
  price: { fontSize: 13.5, color: '#1E1E24', fontFamily: F.regular },
});
