import { createContext, useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * True inside the Shop / Orders / Help / Profile tabs. There the tab bar sits under the screen
 * and already takes the bottom safe-area inset, so anything floating at a screen's bottom edge
 * (the cart bar, Home's fee strip) must not add the inset a second time.
 */
export const InTabsContext = createContext(false);

/** The bottom inset a floating bottom element should keep clear of. */
export function useBottomInset(): number {
  const inTabs = useContext(InTabsContext);
  const insets = useSafeAreaInsets();
  return inTabs ? 0 : insets.bottom;
}
