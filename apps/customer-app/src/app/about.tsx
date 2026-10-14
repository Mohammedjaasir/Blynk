import Constants from 'expo-constants';
import { Text, View } from 'react-native';
import { townFromHub } from '@/blynk/address/forms';
import { openPolicy } from '@/blynk/legal/open';
import { LEGAL, POLICIES, POLICY_ORDER } from '@/blynk/legal/policies';
import { formatHours } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { Body, Card, Chevron, Page, SectionTitle } from '@/blynk/ui/kit';
import { C, F } from '@/lib/theme';

/*
 * About us (Flutter AppAboutScreen, from Profile): the name, the app's version when the platform
 * reports one (never a made-up number), and what Blynk does with the live delivery hours that
 * Ops/Admin set. Then the policies on blynk.lk (Terms, Privacy, Refunds), opened in the browser.
 */
export default function About() {
  const store = useStore();
  const version = Constants.expoConfig?.version;
  const hours = formatHours(store);
  const town = townFromHub(store?.hub_name);
  return (
    <Page title="About us" bg="#fff">
      <Text style={{ fontFamily: F.black, fontSize: 34, color: C.ink, letterSpacing: -0.6 }}>Blynk</Text>
      {!!version && <Text style={{ fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 4 }}>Version {version}</Text>}
      <Body style={{ marginTop: 22, lineHeight: 21 }}>
        {`Blynk delivers freshly sourced groceries and quality essentials in ${town}. You place the order in the app and pay in cash when it arrives${store?.online_payment?.enabled ? ', or online by card or wallet' : ''}.`}
        {hours ? ` Deliveries go out ${hours}, every day.` : ''}
      </Body>
      <SectionTitle style={{ marginTop: 28 }}>{LEGAL.policiesTitle}</SectionTitle>
      <Card style={{ borderWidth: 1, borderColor: C.line, paddingVertical: 4 }}>
        {POLICY_ORDER.map((k, i) => (
          <Card key={k} onPress={() => openPolicy(k)} label={POLICIES[k].label} style={{ marginBottom: 0, paddingHorizontal: 0, paddingVertical: 12, borderRadius: 0, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 14.5, color: C.ink }}>{POLICIES[k].label}</Text>
              <Chevron />
            </View>
          </Card>
        ))}
      </Card>
    </Page>
  );
}
