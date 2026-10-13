import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { C } from '@/lib/theme';

/**
 * Splash, as in the reference (0:03.8–0:04.6): the launcher icon grows into a plain green
 * card that fills the screen (a container transform, corners easing from icon-round to the
 * screen's own), holds for a beat, then Home takes over: the green fades off there while
 * the page rises into place (see `fromSplash` in home.tsx).
 */
export default function Splash() {
  const { width, height } = useWindowDimensions();
  const grow = useSharedValue(0);

  useEffect(() => {
    grow.value = withTiming(1, { duration: 300, easing: Easing.bezier(0.2, 0, 0, 1) });
    const t = setTimeout(() => router.replace('/home'), 820);
    return () => clearTimeout(t);
  }, []);

  const card = useAnimatedStyle(() => {
    const icon = 58;
    return {
      width: interpolate(grow.value, [0, 1], [icon, width]),
      height: interpolate(grow.value, [0, 1], [icon, height]),
      borderRadius: interpolate(grow.value, [0, 0.8, 1], [16, 26, 0]),
      opacity: interpolate(grow.value, [0, 0.15, 1], [0.6, 1, 1]),
    };
  });

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.card, card]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: C.green },
});
