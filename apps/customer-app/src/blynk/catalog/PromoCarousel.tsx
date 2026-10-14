import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import type { Promotion } from '@/blynk/api/types';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { PROMO } from '../ui/strings';
import {
  AUTO_ADVANCE_MS, destinationHref, nextSlide, promoDestination, RESUME_AFTER_TOUCH_MS, shouldAutoAdvance, slideAt, visiblePromotions,
} from './promoTarget';

/*
 * Home's promotions carousel (Flutter HomeScreenCarousel; GET /promotions, set in Admin / Ops).
 * Banners advance every 3 s, pause for 4 s after a touch, and never move on their own when the
 * OS asks for reduced motion (WCAG 2.2.2). A tap follows the banner's cta_target (promoTarget.ts);
 * a banner without one is not tappable.
 *   ARTWORK  the uploaded banner exactly as designed, no words drawn over it
 *   IMAGE    the photo with the title and subtitle over a shade
 *   SOLID / GRADIENT  the colour(s), the words, and the foreground picture on the right
 */

const GUTTER = 15;
const CARD_H = 150;

export function PromoCarousel({ promotions, width }: { promotions: Promotion[]; width: number }) {
  const slides = useMemo(() => visiblePromotions(promotions), [promotions]);
  const reduced = useReducedMotion();
  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const pausedUntil = useRef(0);
  const n = slides.length;
  const auto = shouldAutoAdvance(n, reduced);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      const next = nextSlide(indexRef.current, n);
      ref.current?.scrollTo({ x: next * width, animated: true });
      indexRef.current = next;
      setIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [auto, n, width]);

  if (!n) return null;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = slideAt(e.nativeEvent.contentOffset.x, width, n);
    if (i !== indexRef.current) { indexRef.current = i; setIndex(i); }
  };
  const pause = () => { pausedUntil.current = Date.now() + RESUME_AFTER_TOUCH_MS; };

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ marginTop: 14 }} accessibilityLabel={PROMO.carousel}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={pause}
        onTouchStart={pause}
      >
        {slides.map((p, i) => (
          <View key={p.id} style={{ width, paddingHorizontal: GUTTER }}>
            <PromoCard promo={p} label={PROMO.slideOf(i + 1, n)} />
          </View>
        ))}
      </ScrollView>
      {n > 1 && (
        <View style={styles.dots} importantForAccessibility="no-hide-descendants">
          {slides.map((p, i) => <View key={p.id} style={[styles.dot, i === index && styles.dotOn]} />)}
        </View>
      )}
    </Animated.View>
  );
}

/** Ink or white, whichever reads on a #rrggbb background. */
export function textOn(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '');
  if (!m) return C.brandInk;
  const v = parseInt(m[1], 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? C.brandInk : '#fff';
}

function PromoCard({ promo: p, label }: { promo: Promotion; label: string }) {
  const dest = promoDestination(p);
  const open = dest ? () => router.push(destinationHref(dest)) : undefined;
  const bgImage = (p.background_type === 'IMAGE' || p.background_type === 'ARTWORK') ? p.background_image_url : null;
  const artwork = p.background_type === 'ARTWORK' && !!bgImage;
  const title = p.title?.trim() || null;
  const name = title ?? PROMO.offer;
  const fg = bgImage ? '#fff' : textOn(p.background_color);
  const colors: [string, string] = [p.background_color || C.brand, p.background_color_end || p.background_color || C.brandDeep];

  const body = (
    <View style={styles.card} accessible accessibilityRole={open ? 'link' : 'image'} accessibilityLabel={`${name}. ${label}`}>
      {bgImage ? (
        <Image source={{ uri: bgImage }} resizeMode="cover" style={StyleSheet.absoluteFill} />
      ) : (
        <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      {!artwork && (
        <>
          {bgImage && <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 0.9, y: 0.5 }} style={StyleSheet.absoluteFill} />}
          {!bgImage && !!p.image_url && <Image source={{ uri: p.image_url }} resizeMode="contain" style={styles.art} />}
          <View style={[styles.words, !bgImage && !!p.image_url && { marginRight: 128 }]}>
            {!!title && <Text style={[styles.title, { color: fg }]} numberOfLines={2}>{title}</Text>}
            {!!p.subtitle?.trim() && <Text style={[styles.sub, { color: fg }]} numberOfLines={2}>{p.subtitle.trim()}</Text>}
            {!!open && !!p.cta_label?.trim() && (
              <View style={[styles.cta, { backgroundColor: fg === '#fff' ? '#fff' : C.brandInk }]}>
                <Text style={[styles.ctaTxt, { color: fg === '#fff' ? C.brandInk : '#fff' }]} numberOfLines={1}>{p.cta_label.trim()}</Text>
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
  return open ? <PressScale onPress={open} scaleTo={0.98}>{body}</PressScale> : body;
}

const styles = StyleSheet.create({
  card: { height: CARD_H, borderRadius: 16, overflow: 'hidden', backgroundColor: C.tile, justifyContent: 'center' },
  art: { position: 'absolute', right: 10, top: 10, bottom: 10, width: 120 },
  words: { paddingHorizontal: 18, gap: 4 },
  title: { fontFamily: F.black, fontSize: 21, lineHeight: 25, letterSpacing: -0.2 },
  sub: { fontFamily: F.medium, fontSize: 13, lineHeight: 17, opacity: 0.92 },
  cta: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 14, paddingHorizontal: 13, height: 28, justifyContent: 'center' },
  ctaTxt: { fontFamily: F.semi, fontSize: 12.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D9D9DF' },
  dotOn: { width: 16, backgroundColor: C.brandInk },
});
