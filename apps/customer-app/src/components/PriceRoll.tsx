import { useFocusEffect } from 'expo-router';
import { memo, useCallback } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, type SharedValue } from 'react-native-reanimated';
import type { PriceRoll as Roll } from '@/blynk/lib/priceRoll';
import { holdPriceRoll, rollBeat } from '@/lib/clock';
import { C, F } from '@/lib/theme';
import { TagIcon } from './icons';
import { StruckPrice } from './StruckPrice';

/*
 * The one small line under a tile's price (owner 2026-10-15, Toing's rolling "Other apps / Our app"
 * line): the struck reference ("MRP LKR 300" / the regular price) slides up and out and the saving
 * ("Save LKR 20", "5% off") slides in from below, then back, every ~2.8 s. What it says is decided
 * in src/blynk/lib/priceRoll.ts. Every tile reads the one shared clock (rollBeat) with its own
 * phase, so ~20 tiles never move in step and nothing re-renders; the clock runs only while a
 * focused screen holds it. Fixed height (the tile never jumps); line A alone, still, under reduced
 * motion or when there is no clean saving. A screen reader gets both facts as one label.
 */
export const ROLL_LH = 17;
const HOLD = 0.446; // share of the loop each line rests (2 × 0.446 + 2 × 0.054 slides = 1)
const SLIDE = 0.5 - HOLD;

export const PriceRoll = memo(function PriceRoll({ roll, phase, money, style }: {
  roll: Roll;
  /** 0..1: where in the loop this tile starts (rollPhase). */
  phase: number;
  money: (n: number) => string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const moving = !!roll.saving && !reduced;
  // only while this screen is the one in front (Home stays mounted under a product page)
  useFocusEffect(useCallback(() => (moving ? holdPriceRoll() : undefined), [moving]));
  const lineA = <StruckPrice struck={roll.struck} money={money} style={styles.struck} />;
  return (
    <View
      style={[styles.box, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={roll.label}
    >
      {moving && roll.saving ? (
        <>
          <Line beat={rollBeat} phase={phase} which={0}>{lineA}</Line>
          <Line beat={rollBeat} phase={phase} which={1}>
            <View style={styles.saveRow}>
              <TagIcon size={11} color={C.green} />
              <Text style={styles.save} numberOfLines={1}>{roll.saving.text}</Text>
            </View>
          </Line>
        </>
      ) : (
        <View style={styles.line} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{lineA}</View>
      )}
    </View>
  );
});

function Line({ beat, phase, which, children }: { beat: SharedValue<number>; phase: number; which: 0 | 1; children: React.ReactNode }) {
  const a = useAnimatedStyle(() => {
    const u = (beat.value + phase) % 1;
    // y in line heights: 0 = showing, -1 = gone up, +1 = waiting below. The roll only goes up.
    let y: number;
    if (u < HOLD) y = which === 0 ? 0 : 1;
    else if (u < 0.5) {
      const t = 1 - Math.pow(1 - (u - HOLD) / SLIDE, 3); // ease-out cubic
      y = which === 0 ? -t : 1 - t;
    } else if (u < 0.5 + HOLD) y = which === 0 ? 1 : 0;
    else {
      const t = 1 - Math.pow(1 - (u - 0.5 - HOLD) / SLIDE, 3);
      y = which === 0 ? 1 - t : -t;
    }
    return { opacity: 1 - Math.min(1, Math.abs(y)), transform: [{ translateY: y * ROLL_LH }] };
  });
  return (
    <Animated.View style={[styles.line, a]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { height: ROLL_LH, overflow: 'hidden', marginTop: 1 },
  line: { position: 'absolute', left: 0, right: 0, top: 0, height: ROLL_LH, flexDirection: 'row', alignItems: 'center' },
  struck: { fontSize: 12, lineHeight: ROLL_LH, color: C.faint, fontFamily: F.regular, flexShrink: 1 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  save: { fontSize: 12, lineHeight: ROLL_LH, color: C.green, fontFamily: F.semi, flexShrink: 1 },
});
