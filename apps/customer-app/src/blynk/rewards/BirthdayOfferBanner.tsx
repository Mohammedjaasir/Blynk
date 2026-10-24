import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSession } from '@/blynk/auth/session';
import { useLoad } from '@/blynk/ui/useLoad';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';
import { fetchBirthdayOffer } from './api';
import { birthdayBannerText } from './models';
import { REWARD_WORDS } from './words';

/**
 * "Happy birthday! 10% off one order this week" (Flutter BirthdayOfferBanner, owner 2026-10-09):
 * drawn only while the server's `birthday_offer.eligible` (GET /me) says the gift applies; nothing
 * at all otherwise, for a guest, or in the design mock. Asks again whenever the customer signs in
 * or out. Wording only: the server takes the gift at checkout.
 */
export function BirthdayOfferBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const userId = useSession()?.user.id ?? null;
  const offer = useLoad((signal) => fetchBirthdayOffer(signal), [userId], !!userId && !DEMO).data;

  if (!userId || !offer?.eligible) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} style={[s.box, style]} accessibilityRole="summary">
      <View style={s.icon}><Text style={s.iconTxt}>%</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{birthdayBannerText(offer)}</Text>
        <Text style={s.sub}>{REWARD_WORDS.birthdayBannerSub}</Text>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.brandTint, borderRadius: 14, padding: 12 },
  icon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontFamily: F.black, fontSize: 14, color: C.brandInk },
  title: { fontFamily: F.semi, fontSize: 14, color: C.brandText },
  sub: { fontFamily: F.regular, fontSize: 12, color: C.brandText, marginTop: 2 },
});
