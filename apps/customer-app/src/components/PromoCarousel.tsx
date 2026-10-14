import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import type { Promotion } from '@/blynk/api/types';
import { autoAdvances, CAROUSEL as K, carouselOrder, nextSlide, slideLook, type SlideLook } from '@/blynk/promo/carousel';
import type { BandLink } from '@/blynk/promo/promoBand';
import { openAisle } from '@/lib/nav';
import { F } from '@/lib/theme';

/*
 * Home's promotion carousel, built to docs/promo-surfaces.md §2 so it moves exactly like the
 * live previews in Admin and Ops: a 2:1 card (360 x 180 at 390 pt), 4 s per slide, a 450 ms
 * push to the next one (carrying on forward after the last), the new slide's words, picture
 * and button easing in, a swipe pauses it for 4 s, and "reduce motion" stops the auto-advance
 * and every animation. Not wired into Home yet - Home's owner adopts it.
 */

function go(link: BandLink) {
  if (link.kind === 'aisle') openAisle({ slug: link.slug, name: link.name });
  else if (link.kind === 'product') router.push({ pathname: '/p/[id]', params: { id: link.id } });
  else router.push('/search');
}

const EASE = Easing.bezier(0.65, 0, 0.35, 1);

export function PromoCarousel({ promotions, onOpen = go }: { promotions: Promotion[]; onOpen?: (link: BandLink) => void }) {
  const { width: screenW } = useWindowDimensions();
  const W = screenW - K.gutter * 2;
  const slides = useMemo(() => carouselOrder(promotions).map((p) => ({ id: p.id, look: slideLook(p) })), [promotions]);
  const n = slides.length;
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const p = useSharedValue(1);
  const dir = useSharedValue(1);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);

  const change = (to: number, d: 1 | -1) => {
    if (n < 2) return;
    setPrev(idx);
    setIdx(to);
    dir.value = d;
    if (reduced) { p.value = 1; return; }
    p.value = 0;
    p.value = withTiming(1, { duration: K.change, easing: EASE });
  };

  useEffect(() => { if (idx >= n) { setIdx(0); setPrev(null); } }, [n]);

  // auto-advance
  useEffect(() => {
    if (!autoAdvances(n, reduced) || paused) return;
    const t = setTimeout(() => change(nextSlide(idx, n), 1), K.hold);
    return () => clearTimeout(t);
  }, [idx, n, reduced, paused]);

  useEffect(() => () => { if (resume.current) clearTimeout(resume.current); }, []);
  const touched = () => {
    setPaused(true);
    if (resume.current) clearTimeout(resume.current);
    resume.current = setTimeout(() => setPaused(false), K.resumeAfterTouch);
  };

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderGrant: touched,
    onPanResponderRelease: (_e, g) => {
      if (g.dx < -40) change(nextSlide(idx, n), 1);
      else if (g.dx > 40) change((idx - 1 + n) % n, -1);
    },
  }), [idx, n, reduced]);

  const curA = useAnimatedStyle(() => ({ transform: [{ translateX: dir.value * (1 - p.value) * W }] }));
  const prevA = useAnimatedStyle(() => ({ transform: [{ translateX: -dir.value * p.value * W }], opacity: p.value >= 1 ? 0 : 1 }));

  if (n === 0) return null;
  const cur = slides[Math.min(idx, n - 1)]!;
  const old = prev != null && prev !== idx ? slides[prev] : undefined;
  return (
    <View>
      <View style={[styles.card, { width: W, height: K.height }]} {...pan.panHandlers}>
        {old && (
          <Animated.View key={`p${old.id}`} style={[StyleSheet.absoluteFill, prevA]}>
            <Slide look={old.look} w={W} animate={false} onOpen={onOpen} />
          </Animated.View>
        )}
        <Animated.View key={`c${cur.id}-${idx}`} style={[StyleSheet.absoluteFill, curA]}>
          <Slide look={cur.look} w={W} animate={!reduced && prev != null} onOpen={onOpen} />
        </Animated.View>
      </View>
      {n > 1 && (
        <View style={styles.dots} accessibilityRole="tablist">
          {slides.map((s, i) => (
            <Pressable
              key={s.id}
              hitSlop={6}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === idx }}
              accessibilityLabel={`Promotion ${i + 1} of ${n}`}
              onPress={() => { touched(); if (i !== idx) change(i, i > idx ? 1 : -1); }}
              style={[styles.dot, i === idx && styles.dotOn]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** One slide, drawn from its look; `animate` plays the entrance. */
function Slide({ look, w, animate, onOpen }: { look: SlideLook; w: number; animate: boolean; onOpen: (l: BandLink) => void }) {
  const t = useSharedValue(animate ? 0 : 1);
  const f = useSharedValue(animate ? 0 : 1);
  const c = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    const E = K.enter;
    t.value = withDelay(E.textDelay, withTiming(1, { duration: E.text, easing: Easing.out(Easing.quad) }));
    f.value = withDelay(E.fgDelay, withTiming(1, { duration: E.fg, easing: Easing.out(Easing.back(1.4)) }));
    c.value = withDelay(E.ctaDelay, withTiming(1, { duration: E.cta }));
  }, []);
  const textA = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateX: (1 - t.value) * -12 }] }));
  const fgA = useAnimatedStyle(() => ({ opacity: Math.min(1, f.value * 1.5), transform: [{ translateY: (1 - f.value) * 16 }, { scale: 0.94 + 0.06 * f.value }] }));
  const ctaA = useAnimatedStyle(() => ({ opacity: c.value }));

  const bg = look.background;
  const open = look.link ? () => onOpen(look.link!) : undefined;
  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      disabled={!look.wholeCardTap || !open}
      onPress={open}
      accessibilityRole={look.wholeCardTap ? 'button' : 'image'}
      accessibilityLabel={look.title}
    >
      {bg.kind === 'solid' && <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.color }]} />}
      {bg.kind === 'gradient' && <LinearGradient colors={[bg.from, bg.to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      {(bg.kind === 'image' || bg.kind === 'artwork') && <FocalImage uri={bg.uri} w={w} h={K.height} fx={bg.focalX} fy={bg.focalY} />}
      {bg.kind === 'image' && <View style={[StyleSheet.absoluteFill, { backgroundColor: bg.scrim }]} />}

      {look.foreground && (
        <Animated.View pointerEvents="none" style={[styles.fg, { maxWidth: w * K.foreground.maxWidthPct, width: w * K.foreground.maxWidthPct }, fgA]}>
          <Image source={{ uri: look.foreground }} resizeMode="contain" style={{ width: '100%', height: K.foreground.maxHeight }} />
        </Animated.View>
      )}

      <View style={[styles.safe, { width: w * K.safe.widthPct }]}>
        {look.showText && (
          <Animated.View style={textA}>
            <Text style={[styles.title, { color: look.titleColor }]} numberOfLines={2}>{look.title}</Text>
            {!!look.subtitle && <Text style={[styles.sub, { color: look.subtitleColor }]} numberOfLines={2}>{look.subtitle}</Text>}
          </Animated.View>
        )}
        {!!look.cta && (
          <Animated.View style={[{ marginTop: look.showText ? 12 : 'auto', alignSelf: 'flex-start' }, ctaA]}>
            <Pressable onPress={open} disabled={!open} style={[styles.cta, { backgroundColor: look.ctaColors.bg }]} accessibilityRole="button">
              <Text style={[styles.ctaTxt, { color: look.ctaColors.text }]}>{look.cta}</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </Pressable>
  );
}

/** `cover`, anchored at the stored focal point (% of the picture) instead of the centre. */
function FocalImage({ uri, w, h, fx, fy }: { uri: string; w: number; h: number; fx: number; fy: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    Image.getSize(uri, (iw, ih) => { if (alive && iw > 0 && ih > 0) setSize({ w: iw, h: ih }); }, () => {});
    return () => { alive = false; };
  }, [uri]);
  if (!size) return <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />;
  const s = Math.max(w / size.w, h / size.h);
  const dw = size.w * s;
  const dh = size.h * s;
  return (
    <Image
      source={{ uri }}
      style={{ position: 'absolute', width: dw, height: dh, left: -(dw - w) * (fx / 100), top: -(dh - h) * (fy / 100) }}
    />
  );
}

const styles = StyleSheet.create({
  card: { alignSelf: 'center', borderRadius: K.radius, overflow: 'hidden', backgroundColor: '#F1F4F9' },
  safe: { position: 'absolute', left: K.safe.left, top: K.safe.top, bottom: K.safe.bottom },
  title: { fontFamily: F.black, fontSize: 20, lineHeight: 24 },
  sub: { fontFamily: F.medium, fontSize: 13, lineHeight: 17, marginTop: 6 },
  cta: { height: 30, paddingHorizontal: 14, borderRadius: 15, backgroundColor: '#FFE141', justifyContent: 'center' },
  ctaTxt: { fontFamily: F.bold, fontSize: 12, color: '#1A1D2E' },
  fg: { position: 'absolute', right: K.foreground.right, bottom: 0, alignItems: 'flex-end', justifyContent: 'flex-end' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: K.dots.gap, marginTop: K.dots.top },
  dot: { width: K.dots.size, height: K.dots.size, borderRadius: K.dots.size / 2, backgroundColor: K.dots.off },
  dotOn: { width: K.dots.active, backgroundColor: K.dots.on },
});
