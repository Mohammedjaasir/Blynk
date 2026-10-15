import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteReducer, DELETE_COPY, runDelete } from '@/blynk/account/deleteFlow';
import { showNotice } from '@/blynk/account/notice';
import { accountStyles as A, Button, Card, ErrorText, Row, ScreenHeader, SectionLabel, Sheet } from '@/blynk/account/ui';
import { deleteAccount, getProfile, SMS_LANGUAGES, type AccountProfile } from '@/blynk/api/account';
import { trackShare } from '@/blynk/analytics/track';
import { formatPhone } from '@/blynk/auth/phone';
import { doctorsVisible, showMyAppointments } from '@/blynk/doctors/access';
import { fetchMyAppointments } from '@/blynk/doctors/api';
import { useStore } from '@/blynk/store/StoreContext';
import { needsRegistration, signOut, useSession } from '@/blynk/auth/session';
import { requestPushPermission } from '@/blynk/push';
import { fetchPoints, fetchReferral } from '@/blynk/rewards/api';
import { pointsBalanceText } from '@/blynk/rewards/models';
import { SHARE_BASE_URL } from '@/blynk/share/links';
import { shareText } from '@/blynk/share/share';
import { browserPermission, webPushPossible } from '@/blynk/push/webPlatform';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * Profile (Flutter's ProfileScreen, in its order): who is signed in, then About you, Blynk Points
 * and Refer a friend (each only while its programme is on), Your orders, Address book, SMS &
 * offers, Channel doctors, My appointments, Order updates (web push), Help & support, Send
 * feedback, Share the app, About us, Log out, and - last and set apart - Delete account. A guest browses
 * freely: "Log in" is one clear step.
 */
export default function Account() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const signedIn = !!session && !needsRegistration(session);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [logout, setLogout] = useState(false);
  const [del, dispatch] = useReducer(deleteReducer, { step: 'closed' });
  const [perm, setPerm] = useState(() => (webPushPossible() ? browserPermission() : 'unsupported'));
  // Flutter ProfileRewardsTiles: the points balance and Refer a friend, each while its programme is on
  const [points, setPoints] = useState<{ enabled: boolean; text: string } | null>(null);
  const [referOn, setReferOn] = useState(false);
  // doctors switched off (GET /store doctors_enabled false): only "My appointments", and only for a customer who has some
  const doctorsOn = doctorsVisible(useStore());
  const [hasAppointments, setHasAppointments] = useState(false);
  useEffect(() => {
    if (DEMO || !signedIn || doctorsOn) return;
    const ctrl = new AbortController();
    fetchMyAppointments(1, ctrl.signal).then((a) => setHasAppointments(a.length > 0)).catch(() => undefined);
    return () => ctrl.abort();
  }, [signedIn, doctorsOn, session?.user.id]);
  const appointmentsRow = showMyAppointments(signedIn, doctorsOn, hasAppointments);

  useEffect(() => {
    if (DEMO || !signedIn) return;
    let alive = true;
    fetchPoints().then((p) => { if (alive) setPoints({ enabled: p.enabled, text: pointsBalanceText(p.balance, p.valueLkr) }); }).catch(() => undefined);
    fetchReferral().then((r) => { if (alive) setReferOn(r.enabled); }).catch(() => undefined);
    return () => { alive = false; };
  }, [signedIn, session?.user.id]);

  // a fresh profile for the SMS line (the session keeps only name, phone and email)
  useEffect(() => {
    if (DEMO || !signedIn) return;
    const ctrl = new AbortController();
    getProfile(ctrl.signal).then(setProfile).catch(() => undefined);
    return () => ctrl.abort();
  }, [signedIn, session?.user.id]);

  // a session that needs a name finishes registration first
  useEffect(() => {
    if (!DEMO && session && needsRegistration(session)) router.replace('/register');
  }, [session]);

  const shownProfile = signedIn ? profile : null;
  const user = session?.user;
  const name = (user?.full_name ?? '').trim() || 'My Account';
  const lang = shownProfile ? SMS_LANGUAGES.find((l) => l.wire === shownProfile.sms_language)?.label ?? null : null;
  const smsSub = shownProfile
    ? [lang ? `SMS in ${lang.replace(/ \(.+\)$/, '')}` : 'Pick a language for your SMS', shownProfile.sms_offers ? 'offers on' : 'offers off'].join(' · ')
    : 'SMS language and offers';

  const doLogout = () => {
    setLogout(false);
    signOut();
    router.dismissTo('/home');
  };

  const doDelete = async () => {
    const ok = await runDelete(dispatch, deleteAccount);
    if (ok) {
      // the session end shows "Your account has been deleted." (cleanup.ts)
      router.dismissTo('/home');
    }
  };

  const shareApp = async () => {
    const r = await shareText(`Order groceries on Blynk: ${SHARE_BASE_URL}`, 'Blynk');
    trackShare(r, 'app');
    if (r === 'copied') showNotice('Link copied');
  };

  const askPush = async () => {
    const r = await requestPushPermission();
    setPerm(r);
    if (r === 'denied') showNotice('Notifications are blocked. Allow them for Blynk in your browser settings.');
  };

  const pushSub = perm === 'granted' ? 'On for this phone' : perm === 'denied' ? 'Blocked in your browser settings' : 'Get a note when your order moves';

  return (
    <View style={A.screen}>
      <StatusBar style="dark" />
      <ScreenHeader title="Profile" top={insets.top} onBack={null} />
      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 48 }}>
        <Animated.View entering={FadeIn.duration(200)} style={styles.who}>
          <Text style={styles.name} numberOfLines={1}>{signedIn ? name : 'My Account'}</Text>
          {signedIn && !!user?.phone && <Text style={styles.phone}>{formatPhone(user.phone)}</Text>}
          {signedIn && !!user?.email && user.role === 'CUSTOMER' && <Text style={styles.phone}>{user.email}</Text>}
          {!signedIn && <Text style={styles.phone}>Log in to see your orders, addresses and settings.</Text>}
        </Animated.View>

        {DEMO && <Text style={[A.body, { marginBottom: 12 }]}>Your account opens with ordering. This is a preview.</Text>}

        {!signedIn && !DEMO && (
          <Button label="Log in" onPress={() => router.push('/login')} style={{ marginBottom: 16 }} />
        )}

        <Card>
          {signedIn && <Row icon="🙂" title="About you" sub="Name, email and birthday" onPress={() => router.push('/profile')} />}
          {signedIn && points?.enabled && <Row icon="⭐" title="Blynk Points" sub={points.text} onPress={() => router.push('/points')} />}
          {signedIn && referOn && <Row icon="🎁" title="Refer a friend" sub="Invite friends with your code" onPress={() => router.push('/refer')} />}
          <Row icon="🧾" title="Your orders" onPress={() => router.push('/orders')} />
          <Row icon="📍" title="Address book" onPress={() => router.push('/addresses')} />
          {/* a guest is sent to log in first (Flutter SmsPreferencesScreen.open) */}
          <Row icon="💬" title="SMS & offers" sub={smsSub} onPress={() => router.push(signedIn ? '/settings' : '/login')} last />
        </Card>

        {(doctorsOn || appointmentsRow) && (
          <Card>
            {doctorsOn && <Row icon="🩺" title="Channel doctors" sub="Book an appointment with a doctor" onPress={() => router.push('/doctors')} last={!appointmentsRow} />}
            {appointmentsRow && <Row icon="📅" title="My appointments" onPress={() => router.push('/doctors/appointments')} last />}
          </Card>
        )}

        {signedIn && perm !== 'unsupported' && !DEMO && (
          <Card>
            <Row
              icon="🔔"
              title="Order updates"
              sub={pushSub}
              onPress={perm === 'default' ? askPush : undefined}
              right={perm === 'default' ? <Text style={styles.allow}>Allow</Text> : undefined}
              last
            />
          </Card>
        )}

        <Card>
          <Row icon="🛟" title="Help & support" sub="Call or WhatsApp the store" onPress={() => router.push('/help')} />
          <Row icon="✍️" title="Send feedback" onPress={() => router.push(signedIn ? '/feedback' : '/login')} />
          <Row icon="📤" title="Share the app" onPress={() => void shareApp()} />
          <Row icon="ℹ️" title="About us" onPress={() => router.push('/about')} last={!signedIn} />
          {signedIn && <Row icon="↩️" title="Log out" onPress={() => setLogout(true)} last />}
        </Card>

        {signedIn && (
          <View style={{ marginTop: 24 }}>
            <SectionLabel>Danger zone</SectionLabel>
            <Button label="Delete account" kind="danger" onPress={() => dispatch({ type: 'open' })} style={{}} />
          </View>
        )}
      </ScrollView>

      {logout && (
        <Sheet label="Log out" onClose={() => setLogout(false)}>
          <Text style={A.sheetTitle}>Log out?</Text>
          <Text style={A.body}>You can browse without an account.</Text>
          <View style={A.pair}>
            <Button label="Cancel" kind="secondary" onPress={() => setLogout(false)} style={{ flex: 1 }} />
            <Button label="Log out" kind="danger" onPress={doLogout} style={{ flex: 1 }} />
          </View>
        </Sheet>
      )}

      {(del.step === 'confirm' || del.step === 'deleting') && (
        <Sheet label="Delete account" onClose={del.step === 'confirm' ? () => dispatch({ type: 'cancel' }) : undefined}>
          <Text style={A.sheetTitle}>{DELETE_COPY.title}</Text>
          {DELETE_COPY.points.map((p) => (
            <View key={p} style={styles.point}>
              <View style={styles.bullet} />
              <Text style={[A.body, { flex: 1 }]}>{p}</Text>
            </View>
          ))}
          <ErrorText>{del.step === 'confirm' ? del.error : null}</ErrorText>
          <View style={A.pair}>
            <Button label={DELETE_COPY.cancel} kind="secondary" disabled={del.step === 'deleting'} onPress={() => dispatch({ type: 'cancel' })} style={{ flex: 1 }} />
            <Button label={DELETE_COPY.confirm} kind="danger" busy={del.step === 'deleting'} onPress={doDelete} style={{ flex: 1 }} />
          </View>
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  who: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16 },
  name: { fontFamily: F.bold, fontSize: 20, color: C.ink },
  phone: { fontFamily: F.regular, fontSize: 13.5, color: C.sub, marginTop: 4 },
  allow: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  point: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.sub, marginTop: 7 },
});
