import { router } from 'expo-router';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { townFromHub } from '@/blynk/address/forms';
import { useStore } from '@/blynk/store/StoreContext';
import { ChevronIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import { doctorsVisible } from './access';
import { ToothGlyph } from './glyphs';
import { DOCTOR_UI as W } from './words';

/** Home's "Channel doctors" row (Flutter DentalHomeEntry): opens the clinic list. Hidden while GET /store says doctors_enabled false. */
export function DoctorsHomeEntry({ style }: { style?: StyleProp<ViewStyle> }) {
  const store = useStore();
  const town = townFromHub(store?.hub_name);
  if (!doctorsVisible(store)) return null;
  return (
    <PressScale onPress={() => router.push('/doctors')} scaleTo={0.98} style={style}>
      <View
        style={s.row}
        accessible
        accessibilityRole="button"
        accessibilityLabel={W.homeA11y(town)}
      >
        <View style={s.icon}><ToothGlyph size={22} color={C.brandInk} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{W.title}</Text>
          <Text style={s.sub} numberOfLines={1}>{W.homeSub(town)}</Text>
        </View>
        <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={14} color={C.sub} stroke={2.2} /></View>
      </View>
    </PressScale>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.bg, borderRadius: 14, padding: 12, minHeight: 56 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  sub: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 2 },
});
