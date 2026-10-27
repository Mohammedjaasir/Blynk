import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { accountStyles as A, Button, Sheet } from '@/blynk/account/ui';
import { SELLER_RULE_WORDS } from '@/blynk/cart/sellerWords';
import { closeStartNewCart, startNewCartPrompt, subscribeStartNewCart } from '@/blynk/cart/startNewCart';

/**
 * "Your cart has items from <Seller>. Start a new cart?" (one seller per order). The one app-wide
 * dialog, mounted in the root layout; opened by the cart when an add would bring in a second source.
 */
export function StartNewCartHost() {
  const prompt = useSyncExternalStore(subscribeStartNewCart, startNewCartPrompt, startNewCartPrompt);
  if (!prompt) return null;
  const answer = (fn: () => void) => () => { closeStartNewCart(); fn(); };
  return (
    <Sheet label={SELLER_RULE_WORDS.title} onClose={answer(prompt.keep)}>
      <Text style={A.sheetTitle} accessibilityRole="header">{SELLER_RULE_WORDS.title}</Text>
      <Text style={A.body}>{SELLER_RULE_WORDS.body(prompt.sellerName)}</Text>
      <View style={{ gap: 10, marginTop: 18 }}>
        <Button label={SELLER_RULE_WORDS.clearAndAdd} onPress={answer(prompt.clearAndAdd)} />
        <Button label={SELLER_RULE_WORDS.keep} kind="secondary" onPress={answer(prompt.keep)} />
      </View>
    </Sheet>
  );
}
