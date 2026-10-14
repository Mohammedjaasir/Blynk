import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConfigProblem } from '@/blynk/lib/config';
import { CONFIG } from '@/blynk/ui/strings';
import { C, F } from '@/lib/theme';

/**
 * Shown instead of the app when the build has no usable API address (Flutter ConfigErrorApp).
 * No action: retrying cannot fix a build. Only the short code is shown, so support can tell
 * which check failed.
 */
export function ConfigProblemScreen({ problem }: { problem: ConfigProblem }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityRole="alert">
      <Text style={styles.mark}>!</Text>
      <Text style={styles.title}>{CONFIG.title}</Text>
      <Text style={styles.body}>{Platform.OS === 'web' ? CONFIG.web : CONFIG.native}</Text>
      <Text style={styles.code} selectable>{CONFIG.code(problem)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  mark: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.brand, color: C.brandInk, textAlign: 'center',
    lineHeight: 56, fontFamily: F.black, fontSize: 28, overflow: 'hidden',
  },
  title: { fontFamily: F.bold, fontSize: 19, color: C.ink, marginTop: 18, textAlign: 'center' },
  body: { fontFamily: F.regular, fontSize: 14, color: C.sub, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  code: { fontFamily: F.semi, fontSize: 12.5, color: C.text, marginTop: 14, letterSpacing: 0.3 },
});
