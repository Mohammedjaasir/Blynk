import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { showNotice } from '@/blynk/account/notice';
import { useTrackList } from '@/blynk/analytics/AnalyticsHost';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { ProductCard } from '@/components/ProductCard';
import { cartActions, getCartSnapshot } from '@/lib/cart';
import { C, F, SPACE, T } from '@/lib/theme';
import { USUALS } from '../ui/strings';
import { useUsuals } from './useUsuals';
import { addUsualsInto, availableUsuals, showUsuals, usualsAddedMessage } from './usuals';

/**
 * "Your usuals" on Home (Flutter HomeUsualsRow, owner 2026-10-10): the products of the signed-in
 * customer's last order that was not cancelled, as Home's product cards, with "Add all" putting
 * every product on sale now in the cart at its last quantity. Nothing for a guest, while unknown,
 * on a failure, or before a first order.
 */
export function UsualsRow({ cardWidth = 140 }: { cardWidth?: number }) {
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const usuals = useUsuals();
  useTrackList(showUsuals(signedIn, usuals) ? 'Your usuals' : null, usuals?.items.map((u) => u.product) ?? []);
  if (!showUsuals(signedIn, usuals)) return null;
  const canAdd = availableUsuals(usuals).length > 0;

  const addAll = () => {
    const r = addUsualsInto(usuals, (p, n) => {
      const before = getCartSnapshot().qty[p.id] ?? 0;
      cartActions.setQty(p, before + n);
      return (getCartSnapshot().qty[p.id] ?? 0) - before;
    });
    const m = usualsAddedMessage(r);
    showNotice(m.text, m.ok ? 'info' : 'problem');
  };

  return (
    <Animated.View entering={FadeIn.duration(260)} style={{ marginTop: SPACE.section }}>
      <View style={styles.head}>
        <Text style={styles.h2} accessibilityRole="header">{USUALS.title}</Text>
        {canAdd && (
          <Pressable onPress={addAll} hitSlop={8} accessibilityRole="button" style={styles.addAll}>
            <Text style={styles.addAllTxt}>{USUALS.addAll}</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.sub}>{USUALS.fromLast(usuals.orderNumber)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 15 }}>
        {usuals.items.map((u, i) => (
          <ProductCard key={u.product.id} product={u.product} index={i} width={cardWidth} sub={u.product.category_name} />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 },
  h2: T.section,
  addAll: { backgroundColor: C.brand, borderRadius: 14, paddingHorizontal: 13, height: 28, justifyContent: 'center' },
  addAllTxt: { fontFamily: F.semi, fontSize: 13, color: C.brandInk },
  sub: { ...T.meta, paddingHorizontal: 15, marginTop: 2, marginBottom: SPACE.head },
});
