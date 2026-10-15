import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Product, ProductVariant } from '@/blynk/api/types';
import { lineKey } from '@/blynk/cart/cartStore';
import { fetchProductDetail } from '@/blynk/catalog/product';
import { closeSizePicker, recallDetail, rememberDetail, sizePickerProduct, subscribeSizePicker } from '@/blynk/catalog/sizePicker';
import { deliveredFromText, priceText, VARIANT_COPY, variantPriced } from '@/blynk/catalog/variants';
import { formatLkr } from '@/blynk/lib/money';
import { priceDisplay } from '@/blynk/lib/pricing';
import { useStore } from '@/blynk/store/StoreContext';
import { cartActions, useCartSelect } from '@/lib/cart';
import { C, F } from '@/lib/theme';
import { ProductImage } from './ProductImage';
import { StruckPrice } from './StruckPrice';
import { PressScale, Skeleton } from './ui';

/** The one app-wide size picker (mounted in the root layout); opened by openSizePicker(product). */
export function SizePickerHost() {
  const product = useSyncExternalStore(subscribeSizePicker, sizePickerProduct, sizePickerProduct);
  if (!product) return null;
  return <SizePickerSheet key={product.id} product={product} />;
}

/**
 * Bottom sheet listing a product's sizes (50 g, 100 g, ...) with each one's price, offer and
 * stock; each size has its own "Add" / "− n +" (cart lines are per size). Sold-out sizes are
 * greyed out with "Sold out". The sizes come from GET /catalog/products/:id.
 */
function SizePickerSheet({ product }: { product: Product }) {
  const insets = useSafeAreaInsets();
  const showSavings = useStore()?.show_offer_savings === true;
  const [detail, setDetail] = useState<Product | null>(() => recallDetail(product.id));
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchProductDetail(product.id)
      .then((d) => {
        if (!alive) return;
        rememberDetail(d.product);
        setDetail(d.product);
        setFailed(false);
        // fresh prices and stock for any of its sizes already in the cart
        cartActions.syncVariants(d.product);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [product.id, tick]);

  const shown = detail ?? product;
  const variants = detail?.variants ?? [];
  const lead = deliveredFromText(shown);
  const retry = useCallback(() => { setFailed(false); setTick((n) => n + 1); }, []);

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={styles.backdrop} accessibilityViewIsModal>
      <Pressable style={StyleSheet.absoluteFill} onPress={closeSizePicker} accessibilityLabel="Close" />
      <Animated.View entering={SlideInDown.duration(260)} exiting={SlideOutDown.duration(180)} style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <View style={styles.thumb}><ProductImage product={shown} size={52} radius={10} style={{ backgroundColor: 'transparent' }} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={2}>{shown.name}</Text>
            <Text style={styles.range}>{priceText(shown)}</Text>
            {!!lead && <Text style={styles.lead}>{lead}</Text>}
          </View>
        </View>
        <Text style={styles.title} accessibilityRole="header">{VARIANT_COPY.chooseSize}</Text>
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 4 }}>
          {variants.length > 0 ? (
            variants.map((v) => <VariantRow key={v.id} product={shown} variant={v} showSavings={showSavings} />)
          ) : failed ? (
            <View style={styles.failRow}>
              <Text style={[styles.muted, { flex: 1 }]}>{VARIANT_COPY.loadFailed}</Text>
              <Pressable onPress={retry} hitSlop={8}><Text style={styles.link}>{VARIANT_COPY.retry}</Text></Pressable>
            </View>
          ) : (
            <View style={{ gap: 10, paddingVertical: 6 }} accessibilityLabel="Loading sizes">
              <Skeleton h={48} r={12} /><Skeleton h={48} r={12} /><Skeleton h={48} r={12} />
            </View>
          )}
        </ScrollView>
        <PressScale onPress={closeSizePicker} haptic scaleTo={0.96} style={{ marginTop: 12 }}>
          <View style={styles.done} accessibilityRole="button" accessibilityLabel={VARIANT_COPY.done}>
            <Text style={styles.doneTxt}>{VARIANT_COPY.done}</Text>
          </View>
        </PressScale>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * One size: label, its price (struck regular price on an offer; its own "MRP LKR 300" struck when
 * the price is under its MRP - migration 048), and Add / − n + / Sold out.
 */
function VariantRow({ product, variant: v, showSavings }: { product: Product; variant: ProductVariant; showSavings: boolean }) {
  const shown = priceDisplay(variantPriced(v), { showStruck: showSavings });
  return (
    <View style={[styles.row, !v.is_available && { opacity: 0.55 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{v.label}</Text>
        <View style={styles.priceRow}>
          <Text style={[styles.price, shown.offer && { color: C.brandText }]}>{formatLkr(shown.price)}</Text>
          {shown.struck && <StruckPrice struck={shown.struck} money={formatLkr} style={styles.mrp} />}
        </View>
      </View>
      {v.is_available ? <VariantStepper product={product} variant={v} /> : <Text style={styles.soldOut}>{VARIANT_COPY.soldOut}</Text>}
    </View>
  );
}

/** "Add" for a size not in the cart, else "− n +" for that size's line. */
export function VariantStepper({ product, variant, large }: { product: Product; variant: ProductVariant; large?: boolean }) {
  const key = lineKey(product.id, variant.id);
  const q = useCartSelect((c) => c.lineQty[key] ?? 0);
  if (q === 0) {
    return (
      <PressScale onPress={() => cartActions.add(product, variant)} haptic scaleTo={0.92}>
        <View style={[styles.add, large && styles.addLarge]} accessibilityRole="button" accessibilityLabel={`Add ${variant.label}`}>
          <Text style={styles.addTxt}>ADD</Text>
        </View>
      </PressScale>
    );
  }
  return (
    <View style={[styles.step, large && styles.addLarge]}>
      <Pressable hitSlop={6} onPress={() => cartActions.remove(key)} style={styles.stepBtn} accessibilityLabel={`One less ${variant.label}`}>
        <Text style={styles.stepTxt}>−</Text>
      </Pressable>
      <Text style={styles.stepQty}>{q}</Text>
      <Pressable hitSlop={6} onPress={() => cartActions.add(product, variant)} style={styles.stepBtn} accessibilityLabel={`One more ${variant.label}`}>
        <Text style={styles.stepTxt}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', zIndex: 50 },
  sheet: { backgroundColor: C.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 8 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 12 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  name: { fontFamily: F.bold, fontSize: 16, color: C.ink, lineHeight: 20 },
  range: { fontFamily: F.semi, fontSize: 13.5, color: C.text, marginTop: 2 },
  lead: { fontFamily: F.medium, fontSize: 12, color: C.brandText, marginTop: 2 },
  title: { fontFamily: F.bold, fontSize: 14, color: C.ink, marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderBottomWidth: 1, borderBottomColor: C.line, gap: 10 },
  label: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  price: { fontFamily: F.semi, fontSize: 13.5, color: C.text },
  mrp: { fontFamily: F.regular, fontSize: 12.5, color: '#9A9AA0', textDecorationLine: 'line-through' },
  soldOut: { fontFamily: F.semi, fontSize: 12.5, color: C.sub, paddingHorizontal: 6 },
  add: { minWidth: 76, height: 32, borderRadius: 9, borderWidth: 1, borderColor: C.brandDeep, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  addLarge: { height: 40, minWidth: 104, borderRadius: 12 },
  addTxt: { fontFamily: F.bold, fontSize: 13, color: C.brandInk, letterSpacing: 0.4 },
  step: { minWidth: 76, height: 32, borderRadius: 9, backgroundColor: C.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  stepBtn: { width: 26, height: 28, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontFamily: F.bold, fontSize: 18, color: C.brandInk },
  stepQty: { fontFamily: F.bold, fontSize: 14, color: C.brandInk, minWidth: 16, textAlign: 'center' },
  failRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  muted: { fontFamily: F.regular, fontSize: 13, color: C.sub },
  link: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  done: { height: 50, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontFamily: F.bold, fontSize: 15, color: C.brandInk },
});
