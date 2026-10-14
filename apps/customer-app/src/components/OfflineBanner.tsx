import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useConnectivityBanner } from '@/blynk/lib/connectivity';
import { OFFLINE } from '@/blynk/ui/strings';
import { C, F } from '@/lib/theme';

/**
 * The slim notice while the app has lost its connection and is showing what it already loaded
 * (Flutter ConnectivityBanner / OfflineBanner), then "Back online" for a moment when it returns.
 * Announced as a live region. Fades only (no movement), so reduced motion needs nothing special.
 */
export function OfflineBanner({ onRetry, style }: { onRetry?: () => void; style?: StyleProp<ViewStyle> }) {
  const mode = useConnectivityBanner();
  if (!mode) return null;
  const offline = mode === 'offline';
  return (
    <Animated.View
      key={mode}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={[styles.bar, offline ? styles.off : styles.on, style]}
    >
      <View style={[styles.dot, { backgroundColor: offline ? C.problem : C.green }]} />
      <Text style={[styles.txt, { color: offline ? '#7A2A1F' : C.greenDark }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
        {offline ? OFFLINE.offline : OFFLINE.restored}
      </Text>
      {offline && onRetry && (
        <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
          <Text style={styles.retry}>{OFFLINE.tryAgain}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  off: { backgroundColor: '#FDECEA' },
  on: { backgroundColor: C.greenTint },
  dot: { width: 8, height: 8, borderRadius: 4 },
  txt: { flex: 1, fontFamily: F.semi, fontSize: 12.5 },
  retry: { fontFamily: F.bold, fontSize: 12.5, color: C.ink, textDecorationLine: 'underline' },
});
