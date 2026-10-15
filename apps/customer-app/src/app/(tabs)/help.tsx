import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showNotice } from '@/blynk/account/notice';
import { faqsWithHours, SUPPORT } from '@/blynk/account/support';
import { openStatus } from '@/blynk/account/tabHeroes';
import { accountStyles as A, Card, Enter, Row, SectionLabel } from '@/blynk/account/ui';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { formatHours, radiusText } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { HELP_HERO } from '@/blynk/ui/strings';
import { HelpHero } from '@/components/TabHero';
import { Chevron, Collapsible } from '@/components/ui';
import { C, F } from '@/lib/theme';

/*
 * Help (Flutter's HelpScreen): the questions customers ask most, with the live delivery hours,
 * then "Call us", "WhatsApp us" (the store's support number) and "Send feedback". The number
 * itself is never shown (owner 2026-10-15: "just 'Call us' is enough"): the rows dial and open
 * WhatsApp; where neither can open, the number is copied to paste into the phone app.
 *
 * On top, the yellow hero (src/components/TabHero.tsx) with the store's open-now chip; the
 * questions and contact rows slide in one after another on the first visit, and Call / WhatsApp
 * carry a pulsing green dot while the store is open.
 */
export default function Help() {
  const insets = useSafeAreaInsets();
  const store = useStore();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const hoursLabel = formatHours(store) ?? '8 AM – 9 PM';
  const faqs = faqsWithHours(`${hoursLabel}, every day`);
  const [open, setOpen] = useState<number | null>(null);
  const status = openStatus(store);
  const live = status?.open === true;

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
    showNotice(HELP_HERO.copied);
  };

  return (
    <View style={A.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }}>
        <HelpHero top={insets.top} status={status} bleed={15} />
        {faqs.map((f, i) => (
          <Enter key={f.q} slot={i}>
            <View style={[styles.faq, open === i && styles.faqOpen]}>
              <Pressable onPress={() => setOpen(open === i ? null : i)} style={styles.faqHead} accessibilityRole="button" accessibilityState={{ expanded: open === i }}>
                <Text style={styles.q}>{f.q}</Text>
                <Chevron open={open === i} color={open === i ? C.brandText : C.sub} />
              </Pressable>
              <Collapsible open={open === i}>
                <Text style={[A.body, styles.a]}>{f.a}</Text>
              </Collapsible>
            </View>
          </Enter>
        ))}

        <Card style={{ marginTop: 8 }} tone={C.greenTint} stagger={faqs.length}>
          <Row icon="📞" title={HELP_HERO.call} live={live} liveLabel={HELP_HERO.liveHint} onPress={() => contact(`tel:${SUPPORT.phone}`)} />
          <Row icon="💬" title={HELP_HERO.whatsApp} live={live} liveLabel={HELP_HERO.liveHint} onPress={() => contact(SUPPORT.whatsAppUrl)} />
          <Row icon="✍️" title={HELP_HERO.feedback} onPress={() => router.push(signedIn ? '/feedback' : '/login')} last />
        </Card>

        <Enter slot={faqs.length + 3}>
          <SectionLabel>Our store</SectionLabel>
          <Text style={A.body}>Deliveries go out {hoursLabel}.</Text>
          {!!radiusText(store) && <Text style={[A.body, { marginTop: 4 }]}>{radiusText(store)}.</Text>}
          <Text style={[A.body, { marginTop: 4 }]}>📍 {SUPPORT.hubName}, {SUPPORT.country}</Text>
        </Enter>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  faq: { backgroundColor: '#fff', borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'transparent' },
  faqOpen: { borderColor: C.brandSoft },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, minHeight: 52 },
  q: { flex: 1, fontFamily: F.semi, fontSize: 14, color: C.ink },
  a: { paddingHorizontal: 15, paddingBottom: 14 },
});
