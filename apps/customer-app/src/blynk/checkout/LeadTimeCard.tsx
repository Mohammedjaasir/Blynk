import { StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { C, F } from '@/lib/theme';
import { LEAD_COPY, type LeadState } from './leadTime';

/**
 * Checkout card for a cart holding an item with a delivery lead time (migration 045): which item
 * needs how many days and the first delivery day; with scheduled delivery switched off, that the
 * cart cannot be delivered until the item is removed. Hidden for same-day carts.
 */
export function LeadTimeCard({ lead }: { lead: LeadState }) {
  if (lead.days === 0) return null;
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[s.card, lead.blocked && s.blocked]} accessibilityRole={lead.blocked ? 'alert' : undefined}>
      <Text style={s.head}>{LEAD_COPY.title}</Text>
      <Text style={s.body}>{LEAD_COPY.needs(lead.name, lead.days, lead.dateLabel)}</Text>
      <Text style={[s.hint, lead.blocked && { color: C.problem }]}>{lead.blocked ? LEAD_COPY.slotsOff : LEAD_COPY.pickSlot(lead.dateLabel)}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.brandTint, borderRadius: 14, marginHorizontal: 15, marginBottom: 15, padding: 14, borderWidth: 1, borderColor: C.brandSoft },
  blocked: { backgroundColor: '#FDECEA', borderColor: '#F5C2BC' },
  head: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  body: { fontFamily: F.medium, fontSize: 13.5, color: C.text, marginTop: 4, lineHeight: 19 },
  hint: { fontFamily: F.semi, fontSize: 13, color: C.brandText, marginTop: 6, lineHeight: 18 },
});
