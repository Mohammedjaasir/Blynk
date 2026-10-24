import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import type { Product, PublicBundleOffer } from '@/blynk/api/types';
import type { PlaceOrderBody } from '@/blynk/orders/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { useStore } from '@/blynk/store/StoreContext';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import { getBundleQuote } from './api';
import {
  bundleBadgeNote, bundleBadgeText, bundleOfferFor, giftJustUnlocked, giftLines, giftSignature, liveBundleOffers,
  progressFraction, progressText, usableQuote, type BundleProgress, type BundleQuote,
} from './model';
import { formatLkr } from '@/blynk/lib/money';

/*
 * Bundle offers on screen (owner, 2026-10-25): the badge on a product, the cart's progress card, "Free"
 * and gift lines. The words and the rules are in model.ts; the server decides every amount.
 */

/** The live BUY_X_GET_Y offer that covers this product, or null (also while the store or catalogue has not loaded). */
export function useBundleOffer(product: Pick<Product, 'id' | 'category_id'> | null | undefined): PublicBundleOffer | null {
  const store = useStore();
  const catalog = useCatalog().data;
  const offers = store?.bundle_offers;
  return useMemo(
    () => (product ? bundleOfferFor(product, liveBundleOffers(store), catalog?.chainOf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [offers, catalog?.chainOf, product?.id, product?.category_id],
  );
}

/** The small coloured badge on a product tile ("Buy 2 get 1"); an overlay, so the tile keeps its size. Bottom-left of the photo. */
export function BundleBadge({ offer, width }: { offer: PublicBundleOffer; width: number }) {
  const text = bundleBadgeText(offer, width < 116 ? 'compact' : 'card');
  return (
    <View style={styles.badge} pointerEvents="none" accessible accessibilityLabel={bundleBadgeText(offer, 'full')}>
      <Text style={styles.badgeTxt} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** The product page's version: the full words and one sentence on what it means. */
export function BundleBadgeLine({ offer }: { offer: PublicBundleOffer }) {
  return (
    <View style={styles.pageRow} accessible accessibilityLabel={`${bundleBadgeText(offer, 'full')}. ${bundleBadgeNote(offer)}`}>
      <GiftGlyph size={22} />
      <View style={{ flex: 1 }}>
        <Text style={styles.pageTitle}>{bundleBadgeText(offer, 'full')}</Text>
        <Text style={styles.pageNote}>{bundleBadgeNote(offer)}</Text>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- the quote */

/**
 * The bundle quote for the cart while signed in and the store has live offers: asked again (after a short
 * pause) whenever the basket changes. The last answer stays on screen while the next one loads so the
 * lines do not flicker; a failed or unusable answer clears it (the cart then shows no bundle lines).
 */
export function useBundleQuote({ enabled, items, combos, sig }: {
  enabled: boolean; items: PlaceOrderBody['items']; combos: PlaceOrderBody['combos']; sig: string;
}): BundleQuote | null {
  const [quote, setQuote] = useState<BundleQuote | null>(null);
  useEffect(() => {
    if (!enabled) { setQuote(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      getBundleQuote(items, combos, ctrl.signal)
        .then((q) => { if (!ctrl.signal.aborted) setQuote(usableQuote(q)); })
        .catch(() => { if (!ctrl.signal.aborted) setQuote(null); });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sig]);
  return enabled ? quote : null;
}

/* ---------------------------------------------------------------- the cart */

/** "Add LKR 450 more for a free Biscuit pack" with a thin bar of how far along it is. */
export function BundleProgressCard({ progress, offers }: { progress: BundleProgress | null; offers: readonly PublicBundleOffer[] }) {
  const reduced = useReducedMotion();
  const text = progressText(progress, offers);
  const frac = progressFraction(progress, offers);
  const w = useSharedValue(frac ?? 0);
  useEffect(() => { w.value = withTiming(frac ?? 0, { duration: reduced ? 0 : 450, easing: Easing.out(Easing.cubic) }); }, [frac, reduced]);
  const bar = useAnimatedStyle(() => ({ width: `${Math.round(w.value * 100)}%` }));
  if (!text) return null;
  return (
    <Animated.View entering={FadeIn.duration(reduced ? 0 : 200)} style={styles.progress} accessible accessibilityRole="text" accessibilityLabel={text}>
      <View style={styles.progressTop}>
        <GiftGlyph size={22} />
        <Text style={styles.progressTxt}>{text}</Text>
      </View>
      {frac !== null && (
        <View style={styles.track}><Animated.View style={[styles.fill, bar]} /></View>
      )}
    </Animated.View>
  );
}

/** The "Free" line under a cart line: how many units are free and what that saves. */
export function FreeUnitsRow({ name, sizeLabel, free, value }: { name: string; sizeLabel?: string | null; free: number; value: number }) {
  return (
    <View style={styles.freeRow} accessible accessibilityLabel={`${free} free ${name}, saves ${formatLkr(value)}`}>
      <View style={styles.freeChip}><Text style={styles.freeChipTxt}>Free</Text></View>
      <Text style={styles.freeName} numberOfLines={1}>{free} × {name}{sizeLabel ? ` ${sizeLabel}` : ''}</Text>
      <Text style={styles.freeValue}>−{formatLkr(value)}</Text>
    </View>
  );
}

/**
 * The gift line(s): "Free gift: <name>" with a small present that hops when the gift has just unlocked
 * (a few confetti dots too, unless the phone asks for reduced motion).
 */
export function GiftRows({ quote }: { quote: BundleQuote | null }) {
  const lines = giftLines(quote);
  const sig = giftSignature(quote);
  const prev = useRef<string | null>(null);
  const seen = useRef(false);
  const [burst, setBurst] = useState(0);
  // `prev` is null until the first answer: a gift already there when the cart opened does not celebrate
  useEffect(() => {
    if (quote === null && !seen.current) return;
    seen.current = true;
    if (giftJustUnlocked(prev.current, sig)) setBurst(Date.now());
    prev.current = sig;
  }, [sig, quote]);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((g) => (
        <Animated.View key={g.key} entering={FadeIn.duration(220)} style={styles.giftRow} accessible accessibilityLabel={g.label}>
          <GiftPresent burstKey={burst} />
          <Text style={styles.giftName} numberOfLines={2}>{g.label}</Text>
          <Text style={styles.freeValue}>Free</Text>
        </Animated.View>
      ))}
    </>
  );
}

const DOTS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ angle: (i / 8) * Math.PI * 2 + 0.3, color: [C.brand, C.green, '#FF8A3D', C.brandDeep][i % 4] as string }));

/** The present: pops in with a spring and wobbles; a handful of dots fly out when `burstKey` changes. */
function GiftPresent({ burstKey }: { burstKey: number }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(burstKey ? 0.4 : 1);
  const r = useSharedValue(0);
  const t = useSharedValue(0);
  useEffect(() => {
    if (!burstKey || reduced) return;
    s.value = 0.4;
    s.value = withSpring(1, { damping: 7, stiffness: 180 });
    r.value = withSequence(withTiming(-12, { duration: 90 }), withTiming(12, { duration: 140 }), withTiming(-8, { duration: 120 }), withTiming(0, { duration: 120 }));
    t.value = 0;
    t.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [burstKey, reduced]);
  const box = useAnimatedStyle(() => ({ transform: [{ scale: s.value }, { rotate: `${r.value}deg` }] }));
  return (
    <View style={styles.presentWrap}>
      {!reduced && burstKey > 0 && DOTS.map((d, i) => <ConfettiDot key={`${burstKey}-${i}`} t={t} angle={d.angle} color={d.color} />)}
      <Animated.View style={box}><GiftGlyph size={24} /></Animated.View>
    </View>
  );
}

function ConfettiDot({ t, angle, color }: { t: { value: number }; angle: number; color: string }) {
  const st = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateX: Math.cos(angle) * 26 * t.value }, { translateY: Math.sin(angle) * 26 * t.value - 4 * t.value }, { scale: 1 - t.value * 0.4 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.dot, { backgroundColor: color }, st]} />;
}

/** A small wrapped present, drawn so it needs no asset. */
export function GiftGlyph({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Rect x={3} y={9} width={18} height={12} rx={2} fill={C.brand} stroke={C.brandInk} strokeWidth={1.4} />
      <Rect x={2} y={6} width={20} height={4} rx={1.5} fill={C.brandSoft} stroke={C.brandInk} strokeWidth={1.4} />
      <Path d="M12 6v15" stroke={C.brandInk} strokeWidth={1.4} />
      <Path d="M12 6c-1.2-3-5-3.2-5-1s3 2.2 5 1zM12 6c1.2-3 5-3.2 5-1s-3 2.2-5 1z" fill="none" stroke={C.brandInk} strokeWidth={1.4} strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', left: 6, bottom: 8, backgroundColor: C.green, borderRadius: 8, paddingHorizontal: 6, height: 18, justifyContent: 'center' },
  badgeTxt: { fontFamily: F.semi, fontSize: 9.5, color: C.white },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.greenTint, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 12 },
  pageTitle: { fontFamily: F.semi, fontSize: 14, color: C.greenDark },
  pageNote: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 1 },
  progress: { backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 12, marginHorizontal: 15, marginBottom: 15 },
  progressTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTxt: { flex: 1, fontFamily: F.medium, fontSize: 13.5, color: C.ink, lineHeight: 18 },
  track: { height: 6, borderRadius: 3, backgroundColor: C.line, marginTop: 10, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.green },
  freeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 52, paddingRight: 15, minHeight: 28 },
  freeChip: { backgroundColor: C.greenTint, borderRadius: 7, paddingHorizontal: 6, height: 18, justifyContent: 'center' },
  freeChipTxt: { fontFamily: F.semi, fontSize: 10.5, color: C.greenDark },
  freeName: { flex: 1, fontFamily: F.regular, fontSize: 12, color: C.sub },
  freeValue: { fontFamily: F.semi, fontSize: 12.5, color: C.greenDark },
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, minHeight: 44 },
  giftName: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.ink },
  presentWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },
});
