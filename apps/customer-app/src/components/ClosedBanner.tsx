import { COMPONENT_WORDS } from '@/blynk/ui/componentWords';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { reopensText } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { C, F } from '@/lib/theme';

/** Shown while /store reports is_open_now = false; hidden while the store is open or not loaded yet. */
export function ClosedBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const store = useStore();
  if (!store || store.is_open_now !== false) return null;
  const reopens = reopensText(store);
  return (
    <Animated.View entering={FadeInDown.duration(300)} style={[styles.box, style]} accessibilityRole="alert">
      <View style={styles.dot} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{store.closed_reason?.trim() || COMPONENT_WORDS.storeClosed}</Text>
        <Text style={styles.sub}>{COMPONENT_WORDS.closedSub(reopens)}</Text>
      </View>
    </Animated.View>
  );
}

export const useStoreClosed = () => useStore()?.is_open_now === false;

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.wash, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.yellow },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.problem },
  title: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  sub: { fontFamily: F.regular, fontSize: 11.5, color: C.text, marginTop: 2 },
});
