import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accountErrorText, needsLogin } from '@/blynk/account/errors';
import { showNotice } from '@/blynk/account/notice';
import { accountStyles as A, Button, ErrorText, ScreenHeader } from '@/blynk/account/ui';
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX, feedbackBody, sendFeedback, type FeedbackCategory } from '@/blynk/api/account';
import { useSession } from '@/blynk/auth/session';
import { StarIcon } from '@/components/icons';
import { DEMO } from '@/demo/mode';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * Send feedback (Flutter's FeedbackScreen): an optional 1-5 star rating, what it is about
 * (App / Delivery / Products / Other) and a message, POST /feedback. One way: the Blynk team
 * reads it in Admin. A guest is sent to log in first.
 */
export default function Feedback() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [rating, setRating] = useState<number | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState('');
  const [errs, setErrs] = useState<{ category?: string; message?: string; send?: string }>({});
  const [sending, setSending] = useState(false);

  useEffect(() => { if (!DEMO && !session) router.replace('/login'); }, [session]);

  const send = () => {
    if (sending) return;
    const r = feedbackBody({ category, message, rating });
    if (!r.ok) { setErrs({ category: r.category, message: r.message }); return; }
    setErrs({});
    if (DEMO) { showNotice('Thanks - your feedback was sent'); goBack(); return; }
    setSending(true);
    sendFeedback(r.body)
      .then(() => { showNotice('Thanks - your feedback was sent'); goBack(); })
      .catch((e) => {
        if (needsLogin(e)) { router.replace('/login'); return; }
        setErrs({ send: accountErrorText(e) });
      })
      .finally(() => setSending(false));
  };

  return (
    <View style={A.screen}>
      <StatusBar style="dark" />
      <ScreenHeader title="Send feedback" top={insets.top} />
      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={A.body}>Tell us what went well or what we can do better. The Blynk team reads every message.</Text>

        <Text style={[A.label, styles.gap]}>How was your experience? (optional)</Text>
        <View style={styles.stars} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => setRating(rating === n ? null : n)}
              hitSlop={6}
              accessibilityRole="radio"
              accessibilityState={{ checked: rating === n }}
              accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
              style={styles.star}
            >
              <StarIcon size={28} color={rating !== null && n <= rating ? C.brandDeep : C.line} />
            </Pressable>
          ))}
        </View>

        <Text style={[A.label, styles.gap]}>What is it about?</Text>
        <View style={styles.chips}>
          {FEEDBACK_CATEGORIES.map((c) => {
            const on = category === c.wire;
            return (
              <Pressable
                key={c.wire}
                onPress={() => { setCategory(c.wire); setErrs((e) => ({ ...e, category: undefined })); }}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
              >
                <Text style={[styles.chipTxt, on && { color: '#fff' }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <ErrorText>{errs.category}</ErrorText>

        <Text style={[A.label, styles.gap]}>Your message</Text>
        <TextInput
          value={message}
          onChangeText={(t) => { setMessage(t.slice(0, FEEDBACK_MAX)); setErrs((e) => ({ ...e, message: undefined })); }}
          placeholder="Write your feedback here"
          placeholderTextColor={C.faint}
          multiline
          style={[A.input, styles.area]}
          accessibilityLabel="Your message"
        />
        <Text style={styles.count}>{message.length}/{FEEDBACK_MAX}</Text>
        <ErrorText>{errs.message}</ErrorText>
        <ErrorText>{errs.send}</ErrorText>
        <Button label="Send feedback" onPress={send} busy={sending} style={{ marginTop: 14 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 20 },
  stars: { flexDirection: 'row', gap: 6 },
  star: { padding: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: C.ink, borderColor: C.ink },
  chipTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.ink },
  area: { height: 130, paddingTop: 12, textAlignVertical: 'top' },
  count: { fontFamily: F.regular, fontSize: 11, color: C.faint, textAlign: 'right', marginTop: 4 },
});
