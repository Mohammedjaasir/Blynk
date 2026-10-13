import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing, FadeIn, interpolateColor, SlideInUp, SlideOutUp, useAnimatedStyle, useSharedValue, withRepeat,
  withSequence, withTiming, ZoomIn,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackIcon } from '@/components/icons';
import { PressScale, tap } from '@/components/ui';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

export default function Otp() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const insets = useSafeAreaInsets();
  const { setPhone } = cartActions;
  const [otp, setOtp] = useState('');
  const [secs, setSecs] = useState(25);
  const [sms, setSms] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const input = useRef<TextInput>(null);
  const en = useSharedValue(0);
  const shake = useSharedValue(0);

  /*
   * Preview only: this phase makes no POST, so no OTP is sent and nothing is verified.
   * Verify shows an honest notice (the banner that used to fake an SMS), keeps the number
   * on this device only, and returns to the cart so the rest of the flow can be seen.
   */
  const verify = (code: string) => {
    if (code.length !== 6) {
      shake.set(withSequence(...[10, -10, 8, -8, 0].map((v) => withTiming(v, { duration: 55 }))));
      return;
    }
    tap();
    setVerifying(true);
    setSms(true);
  };

  const enter = (code: string) => {
    setOtp(code);
    en.set(withTiming(code.length === 6 ? 1 : 0, { duration: 250 }));
  };

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  // notice drops, stays long enough to read, then we head back to the cart
  useEffect(() => {
    if (!sms) return;
    const a = setTimeout(() => setSms(false), 2600);
    const b = setTimeout(() => {
      setPhone(phone ?? '');
      router.back();
    }, 2900);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [sms]);


  const btn = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(en.value, [0, 1], [C.greenSoft, C.green]) }));
  const row = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="light" />
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <PressScale onPress={() => router.back()} style={{ padding: 4, alignSelf: 'flex-start' }}><BackIcon color="#fff" /></PressScale>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={styles.title}>Verify details</Text>
            <Text style={styles.sub}>Enter the 6-digit code for +94 {phone}</Text>
          </View>
          <PhoneArt />
        </View>
      </View>

      <Pressable onPress={() => input.current?.focus()} style={{ padding: 16 }}>
        <Text style={styles.label}>Enter OTP</Text>
        <Animated.View style={[styles.slots, row]}>
          {Array.from({ length: 6 }, (_, i) => (
            <Slot key={i} ch={otp[i]} active={i === otp.length} />
          ))}
        </Animated.View>
        <TextInput
          ref={input}
          value={otp}
          onChangeText={(t) => enter(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoFocus
          maxLength={6}
          style={styles.hidden}
        />
        <Text style={styles.retry}>
          Didn&apos;t receive the OTP?{' '}
          {secs > 0 ? `Retry in 00:${String(secs).padStart(2, '0')}` : <Text style={{ color: C.pink, fontFamily: F.bold }} onPress={() => setSecs(25)}>Resend OTP</Text>}
        </Text>
        <PressScale disabled={otp.length < 6} onPress={() => verify(otp)}>
          <Animated.View style={[styles.cta, btn]}>
            {verifying ? <Spinner /> : <Text style={styles.ctaTxt}>{otp.length === 6 ? 'Verify and proceed' : 'Enter OTP'}</Text>}
          </Animated.View>
        </PressScale>
      </Pressable>

      {sms && (
        <Animated.View entering={SlideInUp.springify().mass(1).energyThreshold(1e-4).damping(16)} exiting={SlideOutUp.duration(260)} style={[styles.sms, { top: insets.top + 6 }]}>
          <View style={styles.smsAvatar}><Text style={{ color: '#fff', fontFamily: F.bold }}>B</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.smsFrom}>Blynk · preview</Text>
            <Text style={styles.smsBody} numberOfLines={3}>Phone sign-in opens soon. No code was sent and nothing was verified; your number stays on this device.</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function Slot({ ch, active }: { ch?: string; active: boolean }) {
  const w = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    w.value = withSpring(active || ch ? 1 : 0, { damping: 15, stiffness: 200 });
  }, [active, ch]);
  const line = useAnimatedStyle(() => ({ width: `${30 + w.value * 70}%`, backgroundColor: interpolateColor(w.value, [0, 1], [C.line, C.green]) }));
  return (
    <View style={styles.slot}>
      <View style={{ height: 30, justifyContent: 'flex-end' }}>
        {ch && <Animated.Text key={ch} entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(9)} style={styles.digit}>{ch}</Animated.Text>}
      </View>
      <Animated.View style={[styles.underline, line]} />
    </View>
  );
}

/** Outline phone with blinking "xxxxxx" code. */
function PhoneArt() {
  const b = useSharedValue(1);
  useEffect(() => {
    b.value = withRepeat(withSequence(withTiming(0.2, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: b.value }));
  return (
    <Animated.View entering={FadeIn.delay(200)} style={styles.phone}>
      <View style={styles.notch} />
      <Animated.Text style={[styles.xx, a]}>x x x x x x</Animated.Text>
    </Animated.View>
  );
}

function Spinner() {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.linear }), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  return <Animated.View style={[styles.spinner, a]} />;
}

const styles = StyleSheet.create({
  head: { backgroundColor: C.green, paddingHorizontal: 16, paddingBottom: 0, gap: 10 },
  title: { color: '#fff', fontFamily: F.bold, fontSize: 18 },
  sub: { color: '#DDF2E1', fontFamily: F.regular, fontSize: 12, marginTop: 2, marginBottom: 14 },
  phone: { width: 56, height: 78, borderWidth: 2, borderBottomWidth: 0, borderColor: C.yellow, borderTopLeftRadius: 10, borderTopRightRadius: 10, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10 },
  notch: { position: 'absolute', top: 6, width: 14, height: 3, borderRadius: 2, backgroundColor: C.yellow },
  xx: { color: C.yellow, fontFamily: F.bold, fontSize: 8 },
  label: { fontFamily: F.regular, fontSize: 11, color: C.sub, marginTop: 8 },
  slots: { flexDirection: 'row', gap: 10, marginTop: 8 },
  slot: { flex: 1, alignItems: 'center' },
  digit: { fontFamily: F.semi, fontSize: 22, color: C.ink },
  underline: { height: 2.5, borderRadius: 2, marginTop: 6 },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  retry: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginVertical: 22 },
  cta: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  ctaTxt: { color: '#fff', fontFamily: F.bold, fontSize: 15 },
  spinner: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' },
  sms: {
    position: 'absolute', left: 10, right: 10, backgroundColor: '#2B2A2E', borderRadius: 18, padding: 14, flexDirection: 'row', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, elevation: 12,
  },
  smsAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  smsFrom: { color: '#fff', fontFamily: F.semi, fontSize: 13 },
  smsBody: { color: '#ddd', fontFamily: F.regular, fontSize: 12, marginTop: 2 },
});
