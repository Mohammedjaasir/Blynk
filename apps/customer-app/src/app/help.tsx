import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showNotice } from '@/blynk/account/notice';
import { faqsWithHours, SUPPORT } from '@/blynk/account/support';
import { accountStyles as A, Card, Row, ScreenHeader, SectionLabel } from '@/blynk/account/ui';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { formatHours, radiusText } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { Chevron, Collapsible } from '@/components/ui';
import { C, F } from '@/lib/theme';

/*
 * Help (Flutter's HelpScreen): the questions customers ask most, with the live delivery hours,
 * then "Call us", "WhatsApp us" (the store's support number) and "Send feedback". Where the
 * dialler or WhatsApp cannot open, the number is copied and shown instead.
 */
export default function Help() {
  const insets = useSafeAreaInsets();
  const store = useStore();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const hoursLabel = formatHours(store) ?? '8 AM – 9 PM';
  const faqs = faqsWithHours(`${hoursLabel}, every day`);
  const [open, setOpen] = useState<number | null>(null);

  const contact = async (url: string) => {
    try {
      if (Platform.OS === 'web') {
        const w = (globalThis as { open?: (u: string, t?: string) => unknown }).open;
        if (w) { w(url, url.startsWith('http') ? '_blank' : '_self'); return; }
      } else if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch { /* fall through to copying */ }
    try { await (globalThis as { navigator?: Navigator }).navigator?.clipboard?.writeText(SUPPORT.phone); } catch { /* ignore */ }
    showNotice(`Number copied: ${SUPPORT.phoneLabel}`);
  };

  return (
    <View style={A.screen}>
      <StatusBar style="dark" />
      <ScreenHeader title="Help" top={insets.top} />
      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.intro}>
          <Text style={{ fontSize: 26 }}>🛟</Text>
          <View style={{ flex: 1 }}>
            <Text style={A.heading}>Need a hand?</Text>
            <Text style={A.body}>Answers to the questions we get most.</Text>
          </View>
        </View>

        {faqs.map((f, i) => (
          <View key={f.q} style={styles.faq}>
            <Pressable onPress={() => setOpen(open === i ? null : i)} style={styles.faqHead} accessibilityRole="button" accessibilityState={{ expanded: open === i }}>
              <Text style={styles.q}>{f.q}</Text>
              <Chevron open={open === i} color={C.sub} />
            </Pressable>
            <Collapsible open={open === i}>
              <Text style={[A.body, styles.a]}>{f.a}</Text>
            </Collapsible>
          </View>
        ))}

        <Card style={{ marginTop: 8 }}>
          <Row icon="📞" title={`Call us  ${SUPPORT.phoneLabel}`} onPress={() => contact(`tel:${SUPPORT.phone}`)} />
          <Row icon="💬" title="WhatsApp us" onPress={() => contact(SUPPORT.whatsAppUrl)} />
          <Row icon="✍️" title="Send feedback" onPress={() => router.push(signedIn ? '/feedback' : '/login')} last />
        </Card>

        <SectionLabel>Our store</SectionLabel>
        <Text style={A.body}>Deliveries go out {hoursLabel}.</Text>
        {!!radiusText(store) && <Text style={[A.body, { marginTop: 4 }]}>{radiusText(store)}.</Text>}
        <Text style={[A.body, { marginTop: 4 }]}>📍 {SUPPORT.hubName}, {SUPPORT.country}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14 },
  faq: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 8, overflow: 'hidden' },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, minHeight: 52 },
  q: { flex: 1, fontFamily: F.semi, fontSize: 14, color: C.ink },
  a: { paddingHorizontal: 15, paddingBottom: 14 },
});
