import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Row } from '@/blynk/account/ui';
import { lineUnitPrice } from '@/blynk/cart/cartStore';
import type { Order } from '@/blynk/orders/types';
import { ChevronIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { useCart } from '@/lib/cart';
import { C, F } from '@/lib/theme';
import { LoopIcon } from './art';
import { useRepeatOn } from './gate';
import { useRepeatBaskets } from './hooks';
import { canRepeatOrder, itemsFromCart, itemsFromOrder } from './payload';
import { RepeatCreateSheet, type RepeatSource } from './RepeatSheet';
import { nextRunText } from './schedule';
import { REPEAT_WORDS } from './words';

/*
 * Where repeat baskets are started and found, each mounted with one line by its screen: the
 * delivered order's "Repeat this basket", the cart's card, and Profile's "Repeat baskets" row.
 * Each draws nothing while the feature is off (GET /store repeat_baskets_enabled false, or a 503
 * REPEAT_NOT_READY) or the customer is signed out.
 */

/** Delivered order detail: under "Order again". */
export function RepeatFromOrder({ order, style }: { order: Order; style?: StyleProp<ViewStyle> }) {
  const on = useRepeatOn();
  const [open, setOpen] = useState(false);
  const source = useMemo<RepeatSource>(() => {
    const items = itemsFromOrder(order.items);
    const price = new Map(order.items.map((it) => [`${it.product_id}:${it.variant_id ?? ''}`, it.unit_selling_price] as const));
    return {
      items,
      priceOf: (it) => price.get(`${it.product_id}:${it.variant_id ?? ''}`) ?? null,
      order: {
        line1: order.delivery_address_line1, city: order.delivery_city,
        lat: order.delivery_latitude, lng: order.delivery_longitude, placedAt: order.placed_at ?? order.created_at,
      },
      hadCombos: (order.combos?.length ?? 0) > 0,
    };
  }, [order]);
  if (!on || !canRepeatOrder(order)) return null;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={style}>
      <PressScale onPress={() => setOpen(true)} haptic scaleTo={0.97} style={st.orderBtn} accessibilityRole="button">
        <LoopIcon size={17} />
        <Text style={st.orderTxt}>{REPEAT_WORDS.entries.orderBtn}</Text>
      </PressScale>
      <Text style={st.orderSub}>{REPEAT_WORDS.entries.orderSub}</Text>
      {open && <RepeatCreateSheet source={source} onClose={() => setOpen(false)} />}
    </Animated.View>
  );
}

/** The cart: a card under the items. */
export function RepeatFromCart({ style }: { style?: StyleProp<ViewStyle> }) {
  const on = useRepeatOn();
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const items = useMemo(() => itemsFromCart(cart.lines), [cart.lines]);
  const source = useMemo<RepeatSource>(() => {
    const price = new Map(cart.lines.map((l) => [`${l.product.id}:${l.variant?.id ?? ''}`, lineUnitPrice(l)] as const));
    return { items, priceOf: (it) => price.get(`${it.product_id}:${it.variant_id ?? ''}`) ?? null, hadCombos: cart.combos.length > 0 };
  }, [items, cart.lines, cart.combos.length]);
  if (!on || items.length === 0) return null;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={style}>
      <PressScale onPress={() => setOpen(true)} scaleTo={0.98} style={st.cartCard} accessibilityRole="button" accessibilityLabel={REPEAT_WORDS.entries.orderBtn}>
        <View style={st.cartIcon}><LoopIcon size={18} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.cartTitle}>{REPEAT_WORDS.entries.orderBtn}</Text>
          <Text style={st.cartSub} numberOfLines={1}>{REPEAT_WORDS.entries.cartSub}</Text>
        </View>
        <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View>
      </PressScale>
      {open && <RepeatCreateSheet source={source} onClose={() => setOpen(false)} />}
    </Animated.View>
  );
}

/** Profile: the "Repeat baskets" row (inside a Card, so it joins the card's stagger and icon wash). */
export function RepeatBasketsRow({ last }: { last?: boolean }) {
  const { on, list } = useRepeatBaskets();
  if (!on) return null;
  const active = (list ?? []).filter((b) => b.status === 'ACTIVE');
  const soonest = active.map((b) => b.nextRunAt).filter((x): x is string => !!x).sort()[0];
  const w = REPEAT_WORDS.entries;
  const sub = list === null ? w.rowSubLoading
    : list.length === 0 ? w.rowSubEmpty
      : soonest ? nextRunText(soonest) : w.pausedCount(list.length);
  return <Row icon="🔁" title={w.rowTitle} sub={sub} onPress={() => router.push('/repeat-baskets')} last={last} />;
}

const st = StyleSheet.create({
  orderBtn: {
    height: 46, borderRadius: 23, borderWidth: 1.4, borderColor: C.brandDeep, backgroundColor: C.white,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  orderTxt: { fontFamily: F.semi, fontSize: 15, color: C.brandInk },
  orderSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, textAlign: 'center', marginTop: 6, marginBottom: 12 },
  cartCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.white, borderRadius: 16,
    paddingHorizontal: 15, paddingVertical: 13,
  },
  cartIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' },
  cartTitle: { fontFamily: F.semi, fontSize: 14.5, color: C.ink },
  cartSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 1 },
});
