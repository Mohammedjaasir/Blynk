import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { C } from '@/lib/theme';

/*
 * The repeat basket bottom sheet: the app's sheet look (src/blynk/account/ui.tsx Sheet: dimmed
 * screen, white sheet with 22 pt corners) in a Modal, so a screen can open it from anywhere in
 * its tree (inside a ScrollView too) with one element. It slides up on open and back down before
 * it closes; reduced motion: a short fade.
 */

const CloseCtx = createContext<() => void>(() => {});
/** Closes the sheet this is inside (with its exit animation). */
export const useSheetClose = () => useContext(CloseCtx);

export function SheetModal({ onClose, label, children, busy }: {
  onClose: () => void; label: string; children: ReactNode;
  /** While true the backdrop and the back button do not close it (a request is running). */
  busy?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    p.value = withTiming(1, { duration: reduced ? 160 : 280, easing: Easing.out(Easing.cubic) });
  }, [p, reduced]);
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    p.value = withTiming(0, { duration: reduced ? 120 : 200, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(onClose);
    });
  }, [closing, onClose, p, reduced]);
  const backA = useAnimatedStyle(() => ({ opacity: p.value }));
  const sheetA = useAnimatedStyle(() => (reduced
    ? { opacity: p.value }
    : { transform: [{ translateY: (1 - p.value) * Math.min(height, 700) }] }));
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => { if (!busy) close(); }}>
      <CloseCtx.Provider value={close}>
        <View style={StyleSheet.absoluteFill} accessibilityViewIsModal accessibilityLabel={label}>
          <Animated.View style={[StyleSheet.absoluteFill, st.backdrop, backA]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) close(); }} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View style={[st.sheet, { maxHeight: height * 0.92 - insets.top }, sheetA]}>
            <View style={st.grab} />
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 20 }}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </CloseCtx.Provider>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.38)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.white,
    borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, overflow: 'hidden',
  },
  grab: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 12 },
});
