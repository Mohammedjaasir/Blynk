import { router } from 'expo-router';
import { Text, useWindowDimensions, View } from 'react-native';
import { useSession } from '@/blynk/auth/session';
import { AREA } from '@/blynk/area/copy';
import { centreName, deliveryAreas, kmText, coverageOf } from '@/blynk/area/coverage';
import { CoverageMap } from '@/blynk/area/CoverageMap';
import { useDeliveryLocation } from '@/blynk/address/store';
import { useStore } from '@/blynk/store/StoreContext';
import { Badge, Body, Button, Card, Page } from '@/blynk/ui/kit';
import { C, F } from '@/lib/theme';

/**
 * Where Blynk delivers (owner, 2026-10-14: "we want to showcase the surroundings"): the drawn
 * map around the store with the circle from GET /store, then every nearby place with its
 * distance and whether it is inside. Opened from the coverage card on checkout and the order
 * screens. The customer's chosen spot shows as a blue dot.
 */
export default function DeliveryArea() {
  const store = useStore();
  const session = useSession();
  const loc = useDeliveryLocation();
  const { width } = useWindowDimensions();
  const coverage = coverageOf(store);
  const mapW = Math.min(width, 420) - 30;
  const { inside, outside } = deliveryAreas(coverage);
  const pin = session && loc.address ? { lat: loc.address.latitude, lng: loc.address.longitude } : loc.guestPin;
  return (
    <Page title={AREA.pageTitle} bg="#fff">
      <View style={{ alignItems: 'center' }}>
        <CoverageMap coverage={coverage} width={mapW} height={Math.round(Math.min(mapW, 380))} pin={pin} />
      </View>
      <Text style={{ fontFamily: F.semi, fontSize: 15, color: C.ink, marginTop: 14, lineHeight: 21 }}>{AREA.within(coverage)}</Text>
      <Body sub style={{ marginTop: 2 }}>{AREA.mapNote}</Body>
      <Card style={{ marginTop: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 6 }}>
        {[...inside, ...outside].map((p, i) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.inside ? C.ink : '#fff', borderWidth: p.inside ? 0 : 1.6, borderColor: '#8D8F9C' }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.semi, fontSize: 14.5, color: p.inside ? C.ink : '#8D8F9C' }}>{p.name}</Text>
              <Text style={{ fontFamily: F.regular, fontSize: 12, color: C.sub }}>{p.km < 0.05 ? centreName(coverage) : `${kmText(p.km)} ${AREA.fromStore}`}</Text>
            </View>
            <Badge tone={p.inside ? 'positive' : 'neutral'} label={p.inside ? AREA.inside : AREA.outside} />
          </View>
        ))}
      </Card>
      <Button label={AREA.setAddress} onPress={() => router.push(session ? '/addresses' : '/address')} style={{ marginTop: 6 }} />
    </Page>
  );
}
