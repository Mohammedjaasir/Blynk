import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useHasOpenOrder } from '@/blynk/orders/openOrders';
import { TABS } from '@/blynk/ui/strings';
import { tap } from '@/components/ui';
import { C, F } from '@/lib/theme';

/*
 * The shell's bottom bar (Flutter CustomerShell / AdaptiveScaffold): Shop, Orders, Help,
 * Profile. The selected tab gets Blynk's yellow pill behind its icon; Orders carries a dot
 * while an order is still open. Pushed screens (cart, product, order detail) cover it.
 */

type IconProps = { color: string; active: boolean };
const ICON = 22;

const ShopIcon = ({ color, active }: IconProps) => (
  <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none">
    <Path d="M4 9.5h16l-1.2 10a1.6 1.6 0 0 1-1.6 1.4H6.8a1.6 1.6 0 0 1-1.6-1.4L4 9.5z" fill={active ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    <Path d="M8.5 9.5V7a3.5 3.5 0 0 1 7 0v2.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const OrdersIcon = ({ color, active }: IconProps) => (
  <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none">
    <Path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21V3z" fill={active ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    <Path d="M9 8h6M9 12h6" stroke={active ? C.brand : color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const HelpIcon = ({ color, active }: IconProps) => (
  <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={9} fill={active ? color : 'none'} stroke={color} strokeWidth={1.8} />
    <Path d="M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.6" stroke={active ? C.brand : color} strokeWidth={1.8} strokeLinecap="round" />
    <Rect x={11.1} y={16.2} width={1.8} height={1.8} rx={0.9} fill={active ? C.brand : color} />
  </Svg>
);
const ProfileIcon = ({ color, active }: IconProps) => (
  <Svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={8} r={3.8} fill={active ? color : 'none'} stroke={color} strokeWidth={1.8} />
    <Path d="M4.5 20.5c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6" fill={active ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// the labels are read while rendering (a function), so they follow the chosen language
const TAB_META: Record<string, { label: () => string; Icon: (p: IconProps) => React.ReactElement }> = {
  home: { label: () => TABS.shop, Icon: ShopIcon },
  orders: { label: () => TABS.orders, Icon: OrdersIcon },
  help: { label: () => TABS.help, Icon: HelpIcon },
  account: { label: () => TABS.profile, Icon: ProfileIcon },
};

export const TAB_BAR_H = 58;

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const openOrder = useHasOpenOrder();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route, i) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const focused = state.index === i;
        const badge = route.name === 'orders' && openOrder;
        const onPress = () => {
          const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) {
            tap();
            navigation.navigate(route.name, route.params);
          }
        };
        return (
          <Tab key={route.key} label={meta.label()} Icon={meta.Icon} focused={focused} badge={badge} onPress={onPress} />
        );
      })}
    </View>
  );
}

function Tab({ label, Icon, focused, badge, onPress }: {
  label: string; Icon: (p: IconProps) => React.ReactElement; focused: boolean; badge: boolean; onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const pill = useAnimatedStyle(() => ({
    opacity: withTiming(focused ? 1 : 0, { duration: reduced ? 0 : 160 }),
    transform: [{ scaleX: withTiming(focused ? 1 : 0.6, { duration: reduced ? 0 : 180 }) }],
  }));
  const color = focused ? C.brandInk : C.sub;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge ? `${label}, ${TABS.openOrderBadge}` : label}
      style={styles.tab}
    >
      <View style={styles.iconWrap}>
        <Animated.View style={[styles.pill, pill]} />
        {/* its own layer, so the pill (absolutely positioned) stays behind the icon on the web too */}
        <View style={{ zIndex: 1 }}><Icon color={color} active={focused} /></View>
        {badge && <View style={styles.badge} />}
      </View>
      <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E2E2E8',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8,
  },
  tab: { flex: 1, height: TAB_BAR_H, alignItems: 'center', justifyContent: 'center', gap: 3 },
  iconWrap: { width: 56, height: 30, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 15, backgroundColor: C.brand },
  badge: {
    zIndex: 2, position: 'absolute', top: 2, right: 13, width: 10, height: 10, borderRadius: 5, backgroundColor: C.green,
    borderWidth: 2, borderColor: '#fff',
  },
  label: { fontFamily: F.medium, fontSize: 11.5, color: C.sub },
  labelOn: { fontFamily: F.bold, color: C.brandInk },
});
