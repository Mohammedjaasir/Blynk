import { Linking, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@/blynk/api/client';
import { formatLkr } from '@/blynk/lib/money';
import { Body, Button, Card, Fact, StateView } from '@/blynk/ui/kit';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';
import { isNotFound, isSignInRequired } from './api';
import { DoctorsSignInPrompt } from './Gate';
import { GlyphTile } from './glyphs';
import { ratingLabel } from './types';
import { DOCTOR_FORMAT, DOCTOR_UI as W } from './words';

/* Pieces the doctors screens share (Flutter dental_widgets.dart). */

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : DOCTOR_FORMAT.generic);

/** A load failure: sign-in prompt (SIGN_IN_REQUIRED), not found, or "We couldn't load ..." with Try again. */
export function LoadFailure({ error, title, notFound, onRetry }: {
  error: unknown; title: string; notFound?: { title: string; message: string }; onRetry: () => void;
}) {
  if (isSignInRequired(error)) return <DoctorsSignInPrompt />;
  if (notFound && isNotFound(error)) return <StateView title={notFound.title} message={notFound.message} action={W.goBack} onAction={goBack} />;
  return <StateView title={title} message={errorText(error)} action={W.tryAgain} onAction={onRetry} />;
}

/** "★ 4.6 (12)" read aloud as words; nothing before the first rating. */
export function DoctorRating({ average, count }: { average: number | null; count: number }) {
  const text = ratingLabel(average, count);
  if (!text || average == null) return null;
  return (
    <Text style={s.rating} accessibilityLabel={W.rated(average.toFixed(1), count)}>{text}</Text>
  );
}

/** Doctor photo/glyph, name, specialty and (optionally) the rating, in one row. */
export function DoctorHead({ name, specialty, photo, average, count, size = 48 }: {
  name: string; specialty: string; photo?: string | null; average?: number | null; count?: number; size?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <GlyphTile kind="person" photo={photo} size={size} />
      <View style={{ flex: 1 }}>
        <Text style={size > 60 ? s.titleBig : s.title}>{name}</Text>
        <Text style={s.sub}>{specialty}</Text>
        {average !== undefined && <DoctorRating average={average ?? null} count={count ?? 0} />}
      </View>
    </View>
  );
}

/** The fee the clinic charges in person; nothing is paid in the app. */
export function FeeCard({ label, note, fee }: { label: string; note: string; fee: number | null }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Fact label={label}><Body>{note}</Body></Fact></View>
        {fee != null ? <Text style={s.fee}>{formatLkr(fee)}</Text> : <Text style={s.na}>{W.notAvailable}</Text>}
      </View>
    </Card>
  );
}

/** The clinic's place: "Open in Maps" (a link to Google Maps at its coordinates). */
export function MapLink({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return <Button kind="secondary" small label={W.openInMaps} onPress={() => void Linking.openURL(url).catch(() => {})} style={{ alignSelf: 'flex-start', marginTop: 12 }} />;
}
MapLink.displayName = 'MapLink';

export const s = StyleSheet.create({
  title: { fontFamily: F.semi, fontSize: 15.5, color: C.ink },
  titleBig: { fontFamily: F.bold, fontSize: 20, color: C.ink },
  sub: { fontFamily: F.regular, fontSize: 13, color: C.sub, marginTop: 2 },
  caption: { fontFamily: F.regular, fontSize: 12, color: C.faint, marginTop: 2 },
  rating: { fontFamily: F.semi, fontSize: 12.5, color: C.ink, marginTop: 3 },
  fee: { fontFamily: F.bold, fontSize: 17, color: C.ink },
  na: { fontFamily: F.regular, fontSize: 14, color: C.faint },
  strong: { fontFamily: F.bold, fontSize: 14.5, color: C.ink },
});
