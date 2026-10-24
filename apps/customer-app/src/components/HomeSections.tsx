import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useTrackList } from '@/blynk/analytics/AnalyticsHost';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import {
  countdownUrgent, endsInText, homeSectionViews, nextEndDelay, type HomeSectionView,
} from '@/blynk/promo/homeSections';
import { useStore } from '@/blynk/store/StoreContext';
import { DEMO } from '@/demo/mode';
import { openAisle } from '@/lib/nav';
import { C, F, SPACE, T } from '@/lib/theme';
import { ChevronIcon } from './icons';
import { ProductCard } from './ProductCard';

/*
 * Staff-made Home rails ("Snacks", "Fresh juices", "Weekend offers"), Admin / Ops "Home sections"
 * (2026-10-24). Each is a horizontal product rail like "Under LKR 300", with an optional
 * "Ends in 02:14:09" pill that counts down to the end; when the end comes the rail goes by itself.
 * What shows and how the time reads: src/blynk/promo/homeSections.ts.
 */

const CARD_W = 155; // the same card width as the "Under LKR 300" rail

/* ---------- One shared clock for every countdown on screen ---------- */
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * The time, once a second. One interval serves every countdown; it starts with the first one on
 * screen and stops when the last one goes (nothing counting down: no timer).
 */
function useSecondClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    listeners.add(setNow);
    if (!timer) {
      timer = setInterval(() => {
        const t = Date.now();
        listeners.forEach((l) => l(t));
      }, 1000);
    }
    return () => {
      listeners.delete(setNow);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, []);
  return now;
}

/** "Ends in 02:14:09" on the header; red under an hour. Draws nothing once the time is up. */
function EndsInPill({ endsAtMs }: { endsAtMs: number }) {
  const now = useSecondClock();
  const reduced = useReducedMotion();
  const text = endsInText(endsAtMs, now);
  const urgent = countdownUrgent(endsAtMs, now);

  // a small dot beats once a second beside the time; with reduced motion it just sits there
  const beat = useSharedValue(1);
  useEffect(() => {
    if (reduced) { beat.value = 1; return; }
    beat.value = withRepeat(withSequence(
      withTiming(0.25, { duration: 500, easing: Easing.inOut(Easing.quad) }),
      withTiming(1, { duration: 500, easing: Easing.inOut(Easing.quad) }),
    ), -1);
    return () => cancelAnimation(beat);
  }, [reduced, beat]);
  const dotA = useAnimatedStyle(() => ({ opacity: beat.value }));

  if (text === null) return null;
  const ink = urgent ? C.problem : C.brandInk;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={text}
      style={[s.pill, urgent ? s.pillUrgent : s.pillCalm]}
    >
      <Animated.View style={[s.dot, { backgroundColor: ink }, dotA]} />
      <Text style={[s.pillTxt, { color: ink }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function SectionRail({ view }: { view: HomeSectionView }) {
  useTrackList(`Home: ${view.title}`, view.products);
  const { seeAll } = view;
  const showEnds = view.countdown && view.endsAtMs !== null;
  return (
    <View>
      <View style={s.head}>
        <View style={s.titleRow}>
          <Text style={[T.section, s.title]} numberOfLines={1}>{view.title}</Text>
          {!!seeAll && (
            <Pressable
              onPress={() => openAisle(seeAll)}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityLabel={`See all ${view.title}`}
              style={s.seeAll}
            >
              <Text style={T.seeAll}>See all</Text>
              <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={13} color={C.sub} stroke={2.2} /></View>
            </Pressable>
          )}
        </View>
        {(showEnds || !!view.subtitle) && (
          <View style={s.subRow}>
            {showEnds && <EndsInPill endsAtMs={view.endsAtMs as number} />}
            {!!view.subtitle && <Text style={[T.meta, { flex: 1 }]} numberOfLines={1}>{view.subtitle}</Text>}
          </View>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
        {view.products.map((p, i) => (
          <ProductCard key={p.id} product={p} index={i} width={CARD_W} sub={p.category_name} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Every live section from GET /store `home_sections`, one rail after another. Reads the catalogue and
 * the store itself, so Home mounts it with one line. Nothing for the design mock, an older API, or
 * while there are no sections.
 */
export function HomeSections({ style }: { style?: StyleProp<ViewStyle> }) {
  const { data } = useCatalog();
  const store = useStore();
  const sections = store?.home_sections;
  // moved on when a section's end arrives, so the list is worked out again against the clock
  const [now, setNow] = useState(() => Date.now());

  const views = useMemo(() => homeSectionViews(sections, data, now), [sections, data, now]);

  // when the soonest end arrives, look again: that section leaves without a reload
  useEffect(() => {
    const wait = nextEndDelay(views, Date.now());
    if (wait === null) return;
    const t = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(t);
  }, [views]);

  if (DEMO || views.length === 0) return null;
  return (
    <View style={style}>
      {views.map((v) => <SectionRail key={v.id} view={v} />)}
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: SPACE.gutter, marginTop: SPACE.section, marginBottom: SPACE.head },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { flexShrink: 1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rail: { paddingHorizontal: SPACE.gutter, gap: 15 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: 999, alignSelf: 'flex-start' },
  pillCalm: { backgroundColor: C.brand },
  pillUrgent: { backgroundColor: '#FDECEA' },
  pillTxt: { fontFamily: F.semi, fontSize: 11.5, letterSpacing: 0.1, fontVariant: ['tabular-nums'] },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
