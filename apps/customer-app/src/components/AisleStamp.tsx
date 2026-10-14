import { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { aisleBeat } from '@/lib/clock';
import { C } from '@/lib/theme';

/*
 * The aisle card's corner piece (owner, 2026-10-14: "like in Toing app it does animation"):
 * Toing's faint rubber stamp swaying in the card corner, half cut off by the card edge, but
 * with no claim text - the ring holds the aisle's own illustrated grocery items, which pop in
 * one after another, bob, and pop out (2.6 s each). Every card reads the one shared clock
 * (aisleBeat) with its own phase, so cards never move in step and nothing re-renders.
 * Transform / opacity only. Static under reduced motion.
 */
const TWO_PI = Math.PI * 2;

export const AisleStamp = memo(function AisleStamp({ items, phase, size = 60, style }: {
  items: readonly [string, string, string];
  /** 0..3: where in the loop this card starts (aislePhase). */
  phase: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  return (
    <View pointerEvents="none" style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {reduced ? <StillStamp items={items} size={size} /> : <MovingStamp items={items} phase={phase} size={size} beat={aisleBeat} />}
    </View>
  );
});

function Ring({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" style={StyleSheet.absoluteFill}>
      <Circle cx={32} cy={32} r={30} stroke={C.brandText} strokeOpacity={0.35} strokeWidth={1.4} fill="none" strokeDasharray="3 2.4" />
      <Circle cx={32} cy={32} r={22.5} fill={C.brandTint} stroke={C.brandText} strokeOpacity={0.28} strokeWidth={1} />
    </Svg>
  );
}

function StillStamp({ items, size }: { items: readonly string[]; size: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-14deg' }] }]}>
      <Ring size={size} />
      <View style={styles.center}><Text style={[styles.item, glyph(size)]}>{items[0]}</Text></View>
    </View>
  );
}

function MovingStamp({ items, phase, size, beat }: { items: readonly [string, string, string]; phase: number; size: number; beat: SharedValue<number> }) {
  // the stamp sways like Toing's: a slow tilt and a faint breath (two sways per loop)
  const ringA = useAnimatedStyle(() => {
    const s = Math.sin(TWO_PI * (beat.value * 2 + phase / 3));
    return { transform: [{ rotate: `${-14 + s * 7}deg` }, { scale: 1 + s * 0.03 }] };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, ringA]}>
      <Ring size={size} />
      {items.map((e, k) => <Item key={k} emoji={e} slot={k} phase={phase} size={size} beat={beat} />)}
    </Animated.View>
  );
}

function Item({ emoji, slot, phase, size, beat }: { emoji: string; slot: number; phase: number; size: number; beat: SharedValue<number> }) {
  const a = useAnimatedStyle(() => {
    const u = (beat.value * 3 + phase) % 3;
    const seg = Math.floor(u);
    if (seg !== slot) return { opacity: 0, transform: [{ scale: 0.4 }] };
    const f = u - seg;
    let scale = 1;
    let opacity = 1;
    if (f < 0.16) {
      // pop in with a little overshoot (easeOutBack)
      const t = f / 0.16 - 1;
      scale = 0.4 + 0.6 * (1 + 2.2 * t * t * t + 1.2 * t * t);
    } else if (f > 0.86) {
      const t = (f - 0.86) / 0.14;
      scale = 1 - 0.55 * t;
      opacity = 1 - t;
    }
    const bob = Math.sin(TWO_PI * f * 2);
    return { opacity, transform: [{ translateY: -bob * 2.5 }, { rotate: `${14 + bob * 8}deg` }, { scale }] };
  });
  return (
    <Animated.View style={[styles.center, a]}>
      <Text style={[styles.item, glyph(size)]}>{emoji}</Text>
    </Animated.View>
  );
}

const glyph = (size: number) => ({ fontSize: Math.round(size * 0.4), lineHeight: Math.round(size * 0.52) });

const styles = StyleSheet.create({
  center: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  item: { textAlign: 'center' },
});
