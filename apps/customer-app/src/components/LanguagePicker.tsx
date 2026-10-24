import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGS, setLang } from '@/blynk/i18n/lang';
import { useLang } from '@/blynk/i18n/useLang';
import { C, F } from '@/lib/theme';

/*
 * English / සිංහල / தமிழ் (owner, 2026-10-25). Each name is written in its own script so a customer
 * who cannot read the current language still finds theirs. Choosing one saves it and restarts the
 * screens in that language (the root layout remounts them, see app/_layout.tsx).
 */
export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const lang = useLang();
  return (
    <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel="Language / භාෂාව / மொழி">
      {LANGS.map((l) => {
        const on = l.code === lang;
        return (
          <Pressable
            key={l.code}
            onPress={() => setLang(l.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={l.english}
            style={[s.chip, compact && s.chipCompact, on && s.chipOn]}
          >
            <Text style={[s.txt, compact && s.txtCompact, on && s.txtOn]}>{l.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 6,
  },
  chipCompact: { minHeight: 36, borderRadius: 12 },
  chipOn: { backgroundColor: C.brand, borderColor: C.brandDeep },
  txt: { fontFamily: F.semi, fontSize: 15, lineHeight: 24, color: C.text },
  txtCompact: { fontSize: 13, lineHeight: 20 },
  txtOn: { color: C.brandInk, fontFamily: F.bold },
});
