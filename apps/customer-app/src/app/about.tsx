import Constants from 'expo-constants';
import { Text } from 'react-native';
import { townFromHub } from '@/blynk/address/forms';
import { formatHours } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { Body, Page } from '@/blynk/ui/kit';
import { C, F } from '@/lib/theme';

/*
 * About us (Flutter AppAboutScreen, from Profile): the name, the app's version when the platform
 * reports one (never a made-up number), and what Blynk does with the live delivery hours that
 * Ops/Admin set.
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
        {`Blynk delivers freshly sourced groceries and quality essentials in ${town}. You place the order in the app and pay in cash when it arrives.`}
        {hours ? ` Deliveries go out ${hours}, every day.` : ''}
      </Body>
    </Page>
  );
}
