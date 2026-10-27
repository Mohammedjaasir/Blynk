import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTrackList } from '@/blynk/analytics/AnalyticsHost';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { ChevronIcon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { DEMO } from '@/demo/mode';
import { C, SPACE, T } from '@/lib/theme';
import { LoopIcon } from './art';
import { boughtText, buyAgainView } from './buyAgain';
import { useBuyAgain, useRepeatBaskets } from './hooks';
import { setBuyAgainShown } from './shownStore';
import { REPEAT_WORDS } from './words';

/*
 * Home's "Buy again" (owner, 2026-10-24): the signed-in customer's favourites (anything they have ordered and not cancelled), best
 * first, as Home's product cards with the quick "+" (sold-out ones last, greyed by the card). A
 * guest, or a customer before a first order, sees an animated card instead: groceries
 * pop up one after another and drop into a basket. While repeat baskets are on, the header links
 * to them. Reads everything itself, so Home mounts it with one line.
 */

const CARD_W = 140; // as "Your usuals"

export function BuyAgainRail({ style }: { style?: StyleProp<ViewStyle> }) {
  const { data } = useCatalog();
  const { signedIn, entries } = useBuyAgain();
  const repeat = useRepeatBaskets();
  const view = useMemo(
    () => buyAgainView({ demo: DEMO, signedIn, entries, products: data?.products ?? null }),
    [signedIn, entries, data],
  );
  // tell "Your usuals" what this rail shows (it stays away when it would only repeat it)
  useEffect(() => {
    setBuyAgainShown({
      resolved: DEMO || !signedIn || (entries !== null && data?.products != null),
      ids: view.kind === 'cards' ? view.cards.map((c) => c.product.id) : [],
    });
  }, [view, entries, signedIn, data]);
  useEffect(() => () => setBuyAgainShown(null), []);
  useTrackList(view.kind === 'cards' ? 'Buy again' : null, view.kind === 'cards' ? view.cards.map((c) => c.product) : []);
  if (view.kind === 'hidden') return null;

  const count = repeat.list?.length ?? 0;
  const repeatLink = repeat.on ? (
    <Pressable
      onPress={() => router.push('/repeat-baskets')}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={count ? REPEAT_WORDS.buyAgain.repeatA11y(count) : REPEAT_WORDS.buyAgain.repeatLink}
      style={st.repeatLink}
    >
      <Text style={T.seeAll}>{count ? REPEAT_WORDS.buyAgain.repeatCount(count) : REPEAT_WORDS.buyAgain.repeatLink}</Text>
      <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={13} color={C.sub} stroke={2.2} /></View>
    </Pressable>
  ) : null;

  return (
    <Animated.View entering={FadeIn.duration(260)} style={[{ marginTop: SPACE.section }, style]}>
      <View style={st.head}>
        <View style={st.titleRow}>
          <View style={st.badge}><LoopIcon size={14} /></View>
          <Text style={T.section} accessibilityRole="header">{REPEAT_WORDS.buyAgain.title}</Text>
        </View>
        {repeatLink}
      </View>
      <Text style={st.sub}>{REPEAT_WORDS.buyAgain.sub}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.rail}>
        {view.cards.map((c, i) => (
          <ProductCard key={c.product.id} product={c.product} index={i} width={CARD_W} sub={boughtText(c.timesBought)} />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.gutter },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  repeatLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sub: { ...T.meta, paddingHorizontal: SPACE.gutter, marginTop: 2, marginBottom: SPACE.head },
  rail: { paddingHorizontal: SPACE.gutter, gap: 15 },
});
