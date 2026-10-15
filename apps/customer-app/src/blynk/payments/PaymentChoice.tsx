import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import type { OnlinePaymentInfo } from '@/blynk/api/types';
import { PolicyRow } from '@/blynk/legal/PolicyLinks';
import { C, F } from '@/lib/theme';
import { PAY } from './copy';
import { payOptions, windowNote, type PayMethod } from './method';

/**
 * Checkout's payment choice: "Cash on delivery" / "Pay online (card, wallet)" while online
 * payment is on (otherwise just cash on delivery), with the Terms, Privacy and Refund links.
 */
export function PaymentChoice({ info, toPay, method, onChange, nothingNote }: {
  info: OnlinePaymentInfo | null; toPay: number | null; method: PayMethod; onChange: (m: PayMethod) => void;
  /** The online row's line when there is nothing to pay online (e.g. the wallet covers it). */
  nothingNote?: string;
}) {
  const rows = payOptions(info, toPay, nothingNote);
  const note = windowNote(info);
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{PAY.sectionTitle}</Text>
      <View accessibilityRole="radiogroup">
        {rows.map((r) => {
          const on = r.method === method && r.enabled;
          return (
            <Pressable
              key={r.method}
              onPress={() => r.enabled && onChange(r.method)}
              disabled={!r.enabled}
              style={[styles.row, on && styles.rowOn, !r.enabled && { opacity: 0.55 }]}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !r.enabled }}
              accessibilityLabel={`${r.title}. ${r.sub}`}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowSub}>{r.sub}</Text>
                {r.method === 'ONLINE' && on && !!note && <Text style={[styles.rowSub, { color: C.brandText, marginTop: 3 }]}>{note}</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>
      <PolicyRow style={{ marginTop: 10 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 15, marginBottom: 15, padding: 15 },
  title: { fontFamily: F.semi, fontSize: 15, color: '#222', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1.2, borderColor: '#E6E6EA', marginTop: 8 },
  rowOn: { borderColor: C.brandInk, backgroundColor: C.brandTint },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#B4B4BC', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: C.brandInk },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.brandInk },
  rowTitle: { fontFamily: F.semi, fontSize: 14.5, color: C.ink },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: '#6E6E76', marginTop: 1, lineHeight: 16 },
});
