import { PRICE_ROLL } from '@/blynk/ui/strings';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { struckLabel, type StruckPrice as Struck } from '@/blynk/lib/pricing';

/**
 * The struck reference beside a price (MRP, migration 048; owner 2026-10-14): "MRP LKR 300" with
 * only the amount struck through, or the regular price struck on an offer ("LKR 280"). `style`
 * is the caller's struck style (font, size, colour); the strike is applied to the amount here.
 */
export function StruckPrice({ struck, money, style }: { struck: Struck; money: (n: number) => string; style?: StyleProp<TextStyle> }) {
  const { prefix, amount } = struckLabel(struck, money);
  return (
    <Text
      style={[style, { textDecorationLine: 'none' }]}
      numberOfLines={1}
      accessibilityLabel={prefix ? PRICE_ROLL.mrp(amount) : PRICE_ROLL.regular(amount)}
    >
      {prefix ? `${prefix} ` : ''}
      <Text style={{ textDecorationLine: 'line-through' }}>{amount}</Text>
    </Text>
  );
}
