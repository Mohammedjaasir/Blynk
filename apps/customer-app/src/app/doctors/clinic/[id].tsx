import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fetchClinic, fetchClinicDoctors } from '@/blynk/doctors/api';
import { DoctorsGate } from '@/blynk/doctors/Gate';
import { DoctorHead, LoadFailure, MapLink, s } from '@/blynk/doctors/ui';
import { formatLkr } from '@/blynk/lib/money';
import { Badge, Body, Card, Chevron, ListSkeleton, Page, SectionTitle, StateView } from '@/blynk/ui/kit';
import { useLoad } from '@/blynk/ui/useLoad';
import { DOCTOR_SCREENS as W } from '@/blynk/doctors/words';

const hhmm = (raw: string) => (raw.length >= 5 ? raw.slice(0, 5) : raw);

/** A clinic: where it is, its hours, and its doctors with this clinic's fee (Flutter DentalClinicDetailScreen). */
export default function ClinicScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <DoctorsGate><ClinicDetail id={id} /></DoctorsGate>;
}

function ClinicDetail({ id }: { id: string }) {
  const load = useLoad(async (signal) => {
    const [clinic, doctors] = await Promise.all([fetchClinic(id, signal), fetchClinicDoctors(id, signal)]);
    return { clinic, doctors };
  }, [id]);
  const clinic = load.data?.clinic;

  return (
    <Page title={clinic?.name || W.clinic}>
      {load.loading && !load.data ? (
        <ListSkeleton rows={4} h={90} />
      ) : load.error || !load.data || !clinic ? (
        <LoadFailure
          error={load.error}
          title={W.clinicFailed}
          notFound={{ title: W.clinicNotFound, message: W.clinicNotFoundSub }}
          onRetry={load.reload}
        />
      ) : (
        <View>
          <Card>
            <Text style={s.titleBig}>{clinic.name}</Text>
            <Body sub style={{ marginTop: 6 }}>{clinic.addressLine}</Body>
            <Body sub>{clinic.city}</Body>
            {!!(clinic.operatingStartTime && clinic.operatingEndTime) && (
              <View style={{ marginTop: 10 }}><Badge tone="neutral" label={W.openHours(hhmm(clinic.operatingStartTime), hhmm(clinic.operatingEndTime))} /></View>
            )}
            <MapLink lat={clinic.latitude} lng={clinic.longitude} label={clinic.name} />
          </Card>

          <SectionTitle style={{ marginTop: 14 }}>{W.doctors}</SectionTitle>
          {load.data.doctors.length === 0 ? (
            <StateView title={W.noDoctorsAtClinic} />
          ) : load.data.doctors.map((d, i) => (
            <Animated.View key={d.clinicDoctorId} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(220)}>
              <Card
                onPress={() => router.push({ pathname: '/doctors/doctor/[id]', params: { id: d.doctorId, clinic: id } })}
                label={[d.fullName, d.specialty].join(', ')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <DoctorHead name={d.fullName} specialty={d.specialty} photo={d.photoUrl} average={d.ratingAverage} count={d.ratingCount} />
                    {d.consultationFee != null && <Text style={[s.strong, { marginTop: 8, marginLeft: 60 }]}>{formatLkr(d.consultationFee)}</Text>}
                  </View>
                  <Chevron />
                </View>
              </Card>
            </Animated.View>
          ))}
        </View>
      )}
    </Page>
  );
}
