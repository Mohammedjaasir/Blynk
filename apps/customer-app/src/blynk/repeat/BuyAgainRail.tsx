import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTrackList } from '@/blynk/analytics/AnalyticsHost';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { ChevronIcon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { PressScale } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { C, F, SPACE, T } from '@/lib/theme';
import { BasketPopArt, LoopIcon } from './art';
import { boughtText, buyAgainView } from './buyAgain';
import { useBuyAgain, useRepeatBaskets } from './hooks';
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
  useTrackList(view.kind === 'cards' ? 'Buy again' : null, view.kind === 'cards' ? view.cards.map((c) => c.product) : []);
  if (view.kind === 'hidden') return null;

  const count = repeat.list?.length ?? 0;
  const repeatLink = repeat.on && (view.kind === 'cards' || count > 0) ? (
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
      {view.kind === 'cards' ? (
        <>
          <Text style={st.sub}>{REPEAT_WORDS.buyAgain.sub}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.rail}>
            {view.cards.map((c, i) => (
              <ProductCard key={c.product.id} product={c.product} index={i} width={CARD_W} sub={boughtText(c.timesBought)} />
            ))}
          </ScrollView>
        </>
      ) : (
        <EmptyCard />
      )}
    </Animated.View>
  );
}

/** The animated empty state: "Your favourites will appear here after your first order". */
function EmptyCard() {
  return (
    <View style={st.emptyWrap}>
      <LinearGradient colors={[C.brandTint, '#FFFDF3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.empty}>
        <BasketPopArt scale={0.86} style={{ marginLeft: -6, marginRight: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={st.emptyTitle}>{REPEAT_WORDS.buyAgain.emptyTitle}</Text>
          <Text style={st.emptySub}>{REPEAT_WORDS.buyAgain.emptySub}</Text>
          <PressScale onPress={() => router.push('/categories')} haptic scaleTo={0.95} style={st.cta} accessibilityRole="button">
            <Text style={st.ctaTxt}>{REPEAT_WORDS.buyAgain.startShopping}</Text>
          </PressScale>
        </View>
      </LinearGradient>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.gutter },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  repeatLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sub: { ...T.meta, paddingHorizontal: SPACE.gutter, marginTop: 2, marginBottom: SPACE.head },
  rail: { paddingHorizontal: SPACE.gutter, gap: 15 },
  emptyWrap: { paddingHorizontal: SPACE.gutter, marginTop: SPACE.head },
  empty: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 18, paddingVertical: 12, paddingRight: 14, paddingLeft: 6,
    borderWidth: 1, borderColor: C.brandSoft, overflow: 'hidden',
  },
  emptyTitle: { fontFamily: F.bold, fontSize: 15.5, color: C.ink, letterSpacing: -0.2, lineHeight: 20 },
  emptySub: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 17 },
  cta: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: C.brand, borderRadius: 16, paddingHorizontal: 14, height: 32, justifyContent: 'center' },
  ctaTxt: { fontFamily: F.semi, fontSize: 13, color: C.brandInk },
});
