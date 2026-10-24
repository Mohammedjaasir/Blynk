import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StarIcon } from '@/components/icons';
import { PressScale } from '@/components/ui';
import { Body, Button, Card, Field, SectionTitle, Stars } from '@/blynk/ui/kit';
import { C, F } from '@/lib/theme';
import { cancelAppointment, rateAppointment, RATING_COMMENT_MAX } from './api';
import { cancelRefusalMessage, ratingErrorMessage } from './format';
import { withRating, type Appointment } from './types';
import { DOCTOR_UI as W } from './words';

/*
 * The appointment's cancel and rating sections (Flutter dental_cancel_section.dart and
 * dental_rating_section.dart).
 */

/**
 * "Cancel appointment" with an optional reason and a confirm sheet. After every attempt
 * (success, refusal or timeout) the screen reloads and shows what the server now says.
 */
export function CancelSection({ appointment, onChanged, onMessage }: {
  appointment: Appointment; onChanged: () => void; onMessage: (m: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const insets = useSafeAreaInsets();

  const cancel = async () => {
    setAsking(false);
    if (busy) return;
    setBusy(true);
    const out = await cancelAppointment(appointment.id, reason);
    if (out.error) onMessage(cancelRefusalMessage(out.error));
    setBusy(false);
    onChanged();
  };

  return (
    <View style={{ marginTop: 18 }}>
      <SectionTitle>{W.cancelTitle}</SectionTitle>
      <View style={{ marginTop: -16 }}>
        <Field
          label={W.reasonLabel}
          value={reason}
          onChange={setReason}
          placeholder={W.reasonPlaceholder}
          multiline
          maxLength={255}
          editable={!busy}
        />
      </View>
      <Button label={W.cancelTitle} kind="destructive" busy={busy} onPress={() => setAsking(true)} style={{ marginTop: 14 }} />

      <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
        <Pressable style={st.scrim} onPress={() => setAsking(false)} accessibilityLabel={W.close}>
          <Pressable style={[st.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}} accessibilityViewIsModal>
            <Text style={st.sheetTitle} accessibilityRole="header">{W.cancelThis}</Text>
            <Body sub style={{ marginTop: 6 }}>{W.cannotUndo}</Body>
            <Button label={W.keep} onPress={() => setAsking(false)} style={{ marginTop: 22 }} />
            <Button label={W.cancelTitle} kind="destructive" onPress={() => void cancel()} style={{ marginTop: 10 }} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * "Rate your visit" while the server says it can be rated (can_rate is the only gate), or
 * "Your rating" once given. `compact` (the list) shows a button that opens the form in place.
 */
export function RatingCard({ appointment, onRated, compact }: { appointment: Appointment; onRated: (a: Appointment) => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const r = appointment.rating;
  if (r) {
    return (
      <Card>
        <Text style={st.h}>{W.yourRating}</Text>
        <View style={{ marginTop: 6 }}><Stars stars={r.stars} /></View>
        {!!r.comment && <Body sub style={{ marginTop: 6 }}>{r.comment}</Body>}
      </Card>
    );
  }
  if (!appointment.canRate) return null;
  if (!open) {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={[st.h, { flex: 1 }]}>{W.howWas}</Text>
          <Button label={W.rateVisit} kind="secondary" small onPress={() => setOpen(true)} />
        </View>
      </Card>
    );
  }
  return (
    <Card>
      <SectionTitle>{W.rateVisit}</SectionTitle>
      <RatingForm appointment={appointment} onRated={onRated} />
    </Card>
  );
}

function RatingForm({ appointment, onRated }: { appointment: Appointment; onRated: (a: Appointment) => void }) {
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy || stars == null) return;
    setBusy(true);
    setError(null);
    const out = await rateAppointment(appointment.id, stars, comment);
    setBusy(false);
    if (out.rating) { onRated(out.appointment ?? withRating(appointment, out.rating)); return; }
    if (out.error) setError(ratingErrorMessage(out.error));
  };
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <PressScale key={n} onPress={() => !busy && setStars(n)} scaleTo={0.85} style={st.star}>
            <View accessible accessibilityRole="button" accessibilityLabel={W.stars(n)} accessibilityState={{ selected: stars === n }}>
              <StarIcon size={28} color={stars != null && n <= stars ? C.ink : '#D5D5DC'} />
            </View>
          </PressScale>
        ))}
      </View>
      <Field
        label={W.commentLabel}
        value={comment}
        onChange={setComment}
        placeholder={W.commentPlaceholder}
        multiline
        maxLength={RATING_COMMENT_MAX}
        counter
        editable={!busy}
      />
      {!!error && <Text style={st.err} accessibilityRole="alert">{error}</Text>}
      <Button label={W.submitRating} busy={busy} disabled={stars == null} onPress={() => void submit()} style={{ marginTop: 12 }} />
    </View>
  );
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22 },
  sheetTitle: { fontFamily: F.bold, fontSize: 19, color: C.ink },
  h: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  err: { fontFamily: F.medium, fontSize: 13, color: C.problem, marginTop: 8 },
});
