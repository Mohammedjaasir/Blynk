import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accountErrorText, needsLogin } from '@/blynk/account/errors';
import { showNotice } from '@/blynk/account/notice';
import { ACCOUNT_COMMON, PROFILE_SCREEN as W } from '@/blynk/account/screenWords';
import { accountStyles as A, Button, Card, ErrorText, ScreenHeader } from '@/blynk/account/ui';
import { aboutYouPatch, canEditEmail, getProfile, updateProfile, validEmail, type AccountProfile } from '@/blynk/api/account';
import { parseBirthday, validName } from '@/blynk/auth/forms';
import { formatPhone } from '@/blynk/auth/phone';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { AUTH_ERRORS } from '@/blynk/auth/words';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * About you (Flutter's AboutYouScreen, owner 2026-10-09: all optional): name, the phone number
 * (read-only: one number is one account), email (customers only - staff emails are managed on
 * the Admin Staff page), and the date of birth for the birthday gift. Save sends only what
 * changed (PATCH /me); an emptied birthday is cleared.
 */
export default function AboutYou() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [d, setD] = useState('');
  const [m, setM] = useState('');
  const [y, setY] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; dob?: string; save?: string }>({});
  const [saving, setSaving] = useState(false);

  const fill = (p: AccountProfile) => {
    setProfile(p);
    setName(p.full_name ?? '');
    setEmail(p.email ?? '');
    const [yy = '', mm = '', dd = ''] = (p.date_of_birth ?? '').split('-');
    setD(dd); setM(mm); setY(yy);
  };

  const load = () => {
    if (DEMO || !signedIn) return;
    getProfile().then(fill).catch((e) => setLoadError(accountErrorText(e)));
  };
  useEffect(load, [signedIn]);
  useEffect(() => { if (!DEMO && !session) router.replace('/login'); }, [session]);

  const save = () => {
    if (!profile || saving) return;
    const next: typeof errors = {};
    const okName = validName(name);
    if (!okName) next.name = AUTH_ERRORS.nameError;
    const emailEditable = canEditEmail(profile.role);
    if (emailEditable && email.trim() && !validEmail(email)) next.email = W.emailBad;
    const blankDob = !d.trim() && !m.trim() && !y.trim();
    const dob = blankDob ? null : parseBirthday(d.trim(), m.trim(), y.trim());
    if (!blankDob && !dob) next.dob = W.dobBad;
    setErrors(next);
    if (next.name || next.email || next.dob) return;
    const patch = aboutYouPatch(profile, { full_name: okName ?? '', email, date_of_birth: dob });
    if (!Object.keys(patch).length) { router.back(); return; }
    setSaving(true);
    updateProfile(patch)
      .then((p) => {
        fill(p);
        showNotice(W.saved);
        if (router.canGoBack()) router.back();
      })
      .catch((e) => {
        if (needsLogin(e)) { router.replace('/login'); return; }
        setErrors({ save: accountErrorText(e) });
      })
      .finally(() => setSaving(false));
  };

  return (
    <View style={A.screen}>
      <StatusBar style="dark" />
      <ScreenHeader title={W.title} top={insets.top} />
      {DEMO ? (
        <Text style={[A.body, { padding: 20 }]}>{W.preview}</Text>
      ) : !profile ? (
        <View style={styles.center}>
          {loadError ? (
            <>
              <Text style={[A.body, { textAlign: 'center' }]}>{W.loadFailed}{'\n'}{loadError}</Text>
              <Button label={ACCOUNT_COMMON.tryAgain} onPress={() => { setLoadError(null); load(); }} style={{ marginTop: 14 }} />
            </>
          ) : <ActivityIndicator color={C.brandInk} />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Text style={[A.body, { marginBottom: 14 }]}>{W.intro}</Text>
          <Card style={{ padding: 15 }}>
            <Text style={A.label}>{W.nameLabel}</Text>
            <TextInput value={name} onChangeText={setName} style={A.input} autoComplete="name" maxLength={60} accessibilityLabel={W.nameLabel} />
            <ErrorText>{errors.name}</ErrorText>

            <Text style={[A.label, { marginTop: 16 }]}>{W.phoneLabel}</Text>
            <View style={[A.input, styles.readOnly]}><Text style={styles.readTxt}>{formatPhone(profile.phone)}</Text></View>
            <Text style={styles.hint}>{W.phoneHint}</Text>

            {canEditEmail(profile.role) && (
              <>
                <Text style={[A.label, { marginTop: 16 }]}>{W.emailLabel}</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  style={A.input}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  placeholder="you@example.com"
                  placeholderTextColor={C.faint}
                  accessibilityLabel={W.emailA11y}
                />
                <ErrorText>{errors.email}</ErrorText>
              </>
            )}

            <Text style={[A.label, { marginTop: 16 }]}>{W.dobLabel}</Text>
            <View style={styles.dob}>
              <TextInput value={d} onChangeText={(t) => setD(t.replace(/\D/g, '').slice(0, 2))} placeholder="DD" placeholderTextColor={C.faint} keyboardType="number-pad" style={[A.input, styles.dd]} accessibilityLabel={W.dayA11y} />
              <TextInput value={m} onChangeText={(t) => setM(t.replace(/\D/g, '').slice(0, 2))} placeholder="MM" placeholderTextColor={C.faint} keyboardType="number-pad" style={[A.input, styles.dd]} accessibilityLabel={W.monthA11y} />
              <TextInput value={y} onChangeText={(t) => setY(t.replace(/\D/g, '').slice(0, 4))} placeholder="YYYY" placeholderTextColor={C.faint} keyboardType="number-pad" style={[A.input, { flex: 1 }]} accessibilityLabel={W.yearA11y} />
            </View>
            <Text style={styles.hint}>{W.dobHint}</Text>
            <ErrorText>{errors.dob}</ErrorText>
          </Card>
          <ErrorText>{errors.save}</ErrorText>
          <Button label={ACCOUNT_COMMON.save} onPress={save} busy={saving} style={{ marginTop: 10 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  readOnly: { justifyContent: 'center', backgroundColor: C.bg },
  readTxt: { fontFamily: F.medium, fontSize: 15, color: C.sub },
  hint: { fontFamily: F.regular, fontSize: 11.5, color: C.sub, marginTop: 6, lineHeight: 16 },
  dob: { flexDirection: 'row', gap: 8 },
  dd: { width: 64, textAlign: 'center' },
});
