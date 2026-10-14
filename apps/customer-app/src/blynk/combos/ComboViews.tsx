import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { getCombos } from '@/blynk/api/catalog';
import type { Combo } from '@/blynk/api/types';
import { MAX_COMBO_QTY } from '@/blynk/cart/cartStore';
import { formatLkr } from '@/blynk/lib/money';
import { useStore } from '@/blynk/store/StoreContext';
import { ProductImage } from '@/components/ProductImage';
import { PressScale, tap } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { cartActions, useCartSelect } from '@/lib/cart';
import { C, F } from '@/lib/theme';

/*
 * Combo packs (owner, 2026-10-09; Flutter combo_rail.dart, combo_card.dart, card_combo_cart.dart):
 * a fixed bundle of products at one price below what they cost on their own. GET /combos serves
 * only live ones (a sold-out one comes with is_available: false). Adding one puts a combo line in
 * the cart; the order sends `combos: [{ combo_id, quantity }]` and the server charges the price.
 */

/** "Bread, Eggs ×2, Milk". */
export const comboSummary = (c: Combo) => c.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(', ');

/** Whether the pack really costs less than its products (the only time a struck total and "Save" show). */
export const comboHasSaving = (c: Combo) => c.saving > 0 && c.items_total > c.price;

/** Live combos whose end date has not passed (Flutter ProductProvider.combos). */
export function liveCombos(list: Combo[], now = new Date()): Combo[] {
  return list.filter((c) => !c.ends_at || new Date(c.ends_at).getTime() > now.getTime());
}

/** GET /combos once per mount; fresh copies also refresh combo lines already in the cart. */
export function useCombos(enabled = true): Combo[] {
  const [combos, setCombos] = useState<Combo[]>([]);
  useEffect(() => {
    if (DEMO || !enabled) return;
    let alive = true;
    getCombos()
      .then((r) => {
        if (!alive) return;
        const list = liveCombos(Array.isArray(r?.combos) ? r.combos : []);
        setCombos(list);
        cartActions.syncCombos(list);
      })
      .catch(() => undefined); // the rail simply does not show
    return () => { alive = false; };
  }, [enabled]);
  return combos;
}

/** The pack's own picture, else a 2x2 collage of its products' photos. */
export function ComboThumb({ combo, size, radius = 10 }: { combo: Combo; size: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  if (combo.image_url && !failed) {
    return (
      <View style={[s.thumb, { width: size, height: size, borderRadius: radius }]}>
        <Image source={{ uri: combo.image_url }} accessibilityLabel={combo.name} resizeMode="cover" onError={() => setFailed(true)} style={{ width: size, height: size }} />
      </View>
    );
  }
  const pics = combo.items.slice(0, 4);
  const cell = pics.length <= 1 ? size : size / 2;
  return (
    <View style={[s.thumb, s.collage, { width: size, height: size, borderRadius: radius }]}>
      {pics.map((i) => (
        <ProductImage key={i.product_id} product={i} size={cell} radius={0} style={{ backgroundColor: 'transparent' }} />
      ))}
    </View>
  );
}

/** ADD, then a − n + stepper; "Sold out" while any product in it is sold out. */
export function ComboAdd({ combo, compact }: { combo: Combo; compact?: boolean }) {
  const q = useCartSelect((c) => c.comboQty[combo.id] ?? 0);
  if (!combo.is_available) {
    return <View style={[s.add, s.soldOut, compact && s.addCompact]}><Text style={s.soldTxt}>Sold out</Text></View>;
  }
  if (q === 0) {
    return (
      <PressScale onPress={() => cartActions.addCombo(combo)} haptic scaleTo={0.92}>
        <View style={[s.add, compact && s.addCompact]} accessible accessibilityRole="button" accessibilityLabel={`Add ${combo.name}`}>
          <Text style={s.addTxt}>ADD</Text>
        </View>
      </PressScale>
    );
  }
  return (
    <View style={[s.add, s.stepper, compact && s.addCompact]}>
      <Pressable hitSlop={6} onPress={() => { tap(); cartActions.removeCombo(combo); }} accessibilityLabel={`One less ${combo.name}`}>
        <Text style={s.stepSign}>−</Text>
      </Pressable>
      <Animated.Text key={q} entering={FadeIn.duration(150)} style={s.stepQty}>{q}</Animated.Text>
      <Pressable
        hitSlop={6}
        disabled={q >= MAX_COMBO_QTY}
        onPress={() => { tap(); cartActions.addCombo(combo); }}
        accessibilityLabel={`One more ${combo.name}`}
      >
        <Text style={[s.stepSign, q >= MAX_COMBO_QTY && { opacity: 0.35 }]}>+</Text>
      </Pressable>
    </View>
  );
}

/** One card on Home's rail. */
function ComboCard({ combo, showSavings }: { combo: Combo; showSavings: boolean }) {
  const saving = showSavings && comboHasSaving(combo);
  return (
    <View style={s.card}>
      <View style={!combo.is_available && { opacity: 0.5 }}>
        <ComboThumb combo={combo} size={CARD_W - 20} />
        {saving && <View style={s.saveTag}><Text style={s.saveTxt}>Save {formatLkr(combo.saving)}</Text></View>}
      </View>
      <Text style={s.name} numberOfLines={2}>{combo.name}</Text>
      <Text style={s.summary} numberOfLines={2}>{comboSummary(combo)}</Text>
      <View style={s.priceRow}>
        <View style={{ flex: 1 }}>
          {saving && <Text style={s.strike}>{formatLkr(combo.items_total)}</Text>}
          <Text style={s.price}>{formatLkr(combo.price)}</Text>
        </View>
        <ComboAdd combo={combo} compact />
      </View>
    </View>
  );
}

const CARD_W = 168;

/** Home's "Combo packs" rail: nothing at all until at least one live combo has arrived. */
export function ComboRail({ style }: { style?: StyleProp<ViewStyle> }) {
  const combos = useCombos();
  const store = useStore();
  if (!combos.length) return null;
  const showSavings = store?.show_offer_savings === true;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={style}>
      <Text style={s.h2} accessibilityRole="header">Combo packs</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 12 }}>
        {combos.map((c) => <ComboCard key={c.id} combo={c} showSavings={showSavings} />)}
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  thumb: { backgroundColor: C.tile, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  collage: { flexDirection: 'row', flexWrap: 'wrap' },
  h2: { fontFamily: F.bold, fontSize: 18, color: C.ink, paddingHorizontal: 15, marginBottom: 10, letterSpacing: -0.2 },
  card: { width: CARD_W, backgroundColor: '#fff', borderRadius: 16, padding: 10, borderWidth: 1, borderColor: C.line },
  saveTag: { position: 'absolute', left: 6, top: 6, backgroundColor: C.brand, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  saveTxt: { fontFamily: F.bold, fontSize: 10.5, color: C.brandInk },
  name: { fontFamily: F.semi, fontSize: 14, color: C.ink, marginTop: 8, lineHeight: 18 },
  summary: { fontFamily: F.regular, fontSize: 11.5, color: C.sub, marginTop: 2, lineHeight: 15, minHeight: 30 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 },
  strike: { fontFamily: F.regular, fontSize: 11, color: C.faint, textDecorationLine: 'line-through' },
  price: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  add: {
    height: 32, minWidth: 72, borderRadius: 9, borderWidth: 1.3, borderColor: C.brandDeep, backgroundColor: C.brandTint,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10,
  },
  addCompact: { height: 30, minWidth: 66 },
  addTxt: { fontFamily: F.bold, fontSize: 13, color: C.brandInk, letterSpacing: 0.4 },
  soldOut: { borderColor: C.line, backgroundColor: C.bg },
  soldTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.sub },
  stepper: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.brand, gap: 8 },
  stepSign: { fontFamily: F.bold, fontSize: 16, color: C.brandInk, paddingHorizontal: 2 },
  stepQty: { fontFamily: F.bold, fontSize: 13.5, color: C.brandInk },
});
