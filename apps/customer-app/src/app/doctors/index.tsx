import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fetchClinics } from '@/blynk/doctors/api';
import { DoctorsGate } from '@/blynk/doctors/Gate';
import { GlyphTile } from '@/blynk/doctors/glyphs';
import { LoadFailure, s } from '@/blynk/doctors/ui';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';
import { Card, Chevron, Field, ListSkeleton, Page, StateView } from '@/blynk/ui/kit';
import { useLoad } from '@/blynk/ui/useLoad';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';

/** Channel doctors: the clinic list with search (Flutter DentalClinicsScreen, GET /dental/clinics). */
export default function Clinics() {
  return <DoctorsGate><ClinicList /></DoctorsGate>;
}

function ClinicList() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const clinics = useLoad((signal) => fetchClinics({ search: term || undefined }, signal), [term]);

  return (
    <Page
      title={W.channelDoctors}
      right={(
        <PressScale onPress={() => router.push('/doctors/appointments')} style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
          <Text style={{ fontFamily: F.semi, fontSize: 13.5, color: C.brandText }} accessibilityRole="button">{W.myAppointments}</Text>
        </PressScale>
      )}
    >
      <View style={{ marginTop: -16, marginBottom: 14 }}>
        <Field
          label={W.searchLabel}
          value={q}
          onChange={setQ}
          placeholder={W.searchPlaceholder}
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={() => setTerm(q.trim())}
        />
      </View>
      {clinics.loading && !clinics.data ? (
        <ListSkeleton rows={5} />
      ) : clinics.error ? (
        <LoadFailure error={clinics.error} title={W.clinicsFailed} onRetry={clinics.reload} />
      ) : !clinics.data?.length ? (
        <StateView title={W.noDoctorsYet} />
      ) : (
        clinics.data.map((c, i) => (
          <Animated.View key={c.id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(220)}>
            <Card onPress={() => router.push({ pathname: '/doctors/clinic/[id]', params: { id: c.id } })} label={`${c.name}, ${c.city}, ${c.addressLine}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <GlyphTile />
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{c.name}</Text>
                  <Text style={s.sub}>{c.city}</Text>
                  <Text style={s.caption} numberOfLines={1}>{c.addressLine}</Text>
                </View>
                <Chevron />
              </View>
            </Card>
          </Animated.View>
        ))
      )}
    </Page>
  );
}
