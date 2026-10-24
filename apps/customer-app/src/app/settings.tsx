import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accountErrorText, needsLogin } from '@/blynk/account/errors';
import { showNotice } from '@/blynk/account/notice';
import { ACCOUNT_COMMON, SMS_SCREEN as W } from '@/blynk/account/screenWords';
import { accountStyles as A, Button, Card, ScreenHeader } from '@/blynk/account/ui';
import {
  getProfile, SMS_LANGUAGES, smsLanguagePatch, smsOffersPatch, updateProfile, type AccountProfile, type SmsLanguage,
} from '@/blynk/api/account';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * Profile > SMS & offers (Flutter's SmsPreferencesScreen; every offer SMS points here, so the
 * names are fixed): the language order texts, sign-in codes and offers arrive in
 * (PATCH /me sms_language: si / ta / en), and "Offers by SMS" (PATCH /me sms_offers). Each saves
 * the moment it changes; a failed save puts the old value back and says why.
 */
export default function SmsSettings() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingLang, setSavingLang] = useState(false);
  const [savingOffers, setSavingOffers] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = () => {
    if (DEMO || !signedIn) return;
    getProfile().then((p) => mounted.current && setProfile(p)).catch((e) => mounted.current && setLoadError(accountErrorText(e)));
  };
  useEffect(load, [signedIn]);
  useEffect(() => { if (!DEMO && !session) router.replace('/login'); }, [session]);

  const fail = (e: unknown) => {
    if (needsLogin(e)) { router.replace('/login'); return; }
    showNotice(accountErrorText(e), 'problem');
  };

  const chooseLanguage = (lang: SmsLanguage) => {
    if (!profile || savingLang || profile.sms_language === lang) return;
    const before = profile;
    setProfile({ ...profile, sms_language: lang });
    setSavingLang(true);
    updateProfile(smsLanguagePatch(lang))
      .then((p) => mounted.current && setProfile((cur) => (cur ? { ...cur, sms_language: p.sms_language } : p)))
      .catch((e) => { if (mounted.current) setProfile((cur) => (cur ? { ...cur, sms_language: before.sms_language } : cur)); fail(e); })
      .finally(() => mounted.current && setSavingLang(false));
  };

  const setOffers = (on: boolean) => {
    if (!profile || savingOffers) return;
    const before = profile.sms_offers;
    setProfile({ ...profile, sms_offers: on });
    setSavingOffers(true);
    updateProfile(smsOffersPatch(on))
      .then((p) => mounted.current && setProfile((cur) => (cur ? { ...cur, sms_offers: p.sms_offers } : p)))
      .catch((e) => { if (mounted.current) setProfile((cur) => (cur ? { ...cur, sms_offers: before } : cur)); fail(e); })
      .finally(() => mounted.current && setSavingOffers(false));
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
        <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 40 }}>
          <Card style={{ padding: 15 }}>
            <Text style={A.heading}>{W.languageTitle}</Text>
            <Text style={[A.body, { marginTop: 4 }]}>{W.languageNote}</Text>
            {!profile.sms_language && <Text style={styles.hint}>ⓘ {W.languageHint}</Text>}
            <View style={{ marginTop: 8 }} accessibilityRole="radiogroup">
              {SMS_LANGUAGES.map((l) => {
                const on = profile.sms_language === l.wire;
                return (
                  <Pressable
                    key={l.wire}
                    onPress={() => chooseLanguage(l.wire)}
                    disabled={savingLang}
                    style={styles.choice}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled: savingLang }}
                    accessibilityLabel={l.label}
                  >
                    <View style={[styles.radio, on && styles.radioOn]}>
                      {on && (savingLang ? <ActivityIndicator size="small" color="#fff" /> : <View style={styles.radioDot} />)}
                    </View>
                    <Text style={styles.choiceTxt}>{l.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
          <Card style={{ padding: 15 }}>
            <View style={styles.offerRow}>
              <View style={{ flex: 1 }}>
                <Text style={A.heading}>{W.offersTitle}</Text>
                <Text style={[A.body, { marginTop: 4 }]}>{W.offersNote}</Text>
              </View>
              <Switch
                value={profile.sms_offers}
                onValueChange={setOffers}
                disabled={savingOffers}
                trackColor={{ false: C.line, true: C.ink }}
                thumbColor="#fff"
                // react-native-web colours the "on" thumb with this (teal by default)
                {...({ activeThumbColor: '#fff', activeTrackColor: C.ink } as object)}
                accessibilityLabel={W.offersTitle}
              />
            </View>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hint: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.ink, backgroundColor: C.ink },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  choiceTxt: { fontFamily: F.medium, fontSize: 15, color: C.ink },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
