import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C, F } from '@/lib/theme';
import { openPolicy } from './open';
import { LEGAL, POLICIES, POLICY_ORDER, type PolicyKind } from './policies';

/** "By continuing you agree to the Terms and Privacy Policy." with both as links. */
export function AgreeLine({ style, linkStyle }: { style?: StyleProp<TextStyle>; linkStyle?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.agree, style]}>
      {LEGAL.agreePrefix}
      <Text style={[styles.link, linkStyle]} onPress={() => openPolicy('terms')} accessibilityRole="link">{POLICIES.terms.label}</Text>
      {LEGAL.and}
      <Text style={[styles.link, linkStyle]} onPress={() => openPolicy('privacy')} accessibilityRole="link">{POLICIES.privacy.label}</Text>
      {LEGAL.agreeSuffix}
    </Text>
  );
}

/** "Terms · Privacy Policy · Refund Policy" as small links (checkout, near the payment choice). */
export function PolicyRow({ kinds = POLICY_ORDER, style, center }: { kinds?: readonly PolicyKind[]; style?: StyleProp<ViewStyle>; center?: boolean }) {
  return (
    <View style={[styles.row, center && { justifyContent: 'center' }, style]}>
      {kinds.map((k, i) => (
        <View key={k} style={styles.item}>
          {i > 0 && <Text style={styles.dot}>·</Text>}
          <Pressable onPress={() => openPolicy(k)} hitSlop={6} accessibilityRole="link" accessibilityLabel={POLICIES[k].label}>
            <Text style={styles.small}>{POLICIES[k].label}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  agree: { fontFamily: F.regular, fontSize: 12, color: C.sub, textAlign: 'center', lineHeight: 17 },
  link: { fontFamily: F.semi, color: C.brandText, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center' },
  dot: { fontFamily: F.regular, fontSize: 12, color: C.faint, marginHorizontal: 7 },
  small: { fontFamily: F.semi, fontSize: 12, color: C.brandText, textDecorationLine: 'underline' },
});
