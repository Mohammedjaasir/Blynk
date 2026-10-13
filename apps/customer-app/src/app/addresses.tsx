import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addressErrorText, addressSummary, type SavedAddress } from '@/blynk/address/api';
import { safeReturn } from '@/blynk/address/forms';
import { SmallPin } from '@/blynk/address/pins';
import { chooseAddress, loadAddresses, removeAddress, useDeliveryLocation } from '@/blynk/address/store';
import { formatPhone } from '@/blynk/auth/phone';
import { useSession } from '@/blynk/auth/session';
import { BackIcon } from '@/components/icons';
import { PressScale, Skeleton } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

const T = {
  title: 'Saved addresses',
  choose: 'Choose a delivery address',
  add: 'Add new address',
  addSub: 'Place a pin on the map',
  selected: 'Delivering here',
  isDefault: 'Default',
  edit: 'Edit',
  del: 'Delete',
  confirm: 'Delete this address?',
  cancel: 'Cancel',
  deleting: 'Deleting…',
  empty: 'No saved addresses yet.',
  retry: 'Try again',
  guest: 'Sign in at the cart to save addresses to your account.',
  guestPin: 'Your delivery spot (on this phone)',
  preview: 'Saved addresses arrive with ordering. This is a preview.',
};

/**
 * The signed-in customer's address book: choose one (it becomes the default), edit, delete,
 * or add a new one. `return` (an in-app path) is where choosing one goes back to.
 */
export default function Addresses() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ return?: string }>();
  const ret = safeReturn(params.return);
  const session = useSession();
  const loc = useDeliveryLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // fresh from the server each time the list opens
    if (!DEMO && session) loadAddresses(true).catch(() => undefined);
  }, [session?.user.id]);

  const leave = () => (ret ? router.dismissTo(ret as never) : goBack());
  const add = () => router.push({ pathname: '/address', params: ret ? { return: ret } : {} } as never);
  const edit = (a: SavedAddress) => router.push({ pathname: '/address', params: { id: a.id } } as never);

  const choose = async (a: SavedAddress) => {
    if (busy) return;
    setError(null);
    setBusy(a.id);
    try {
      await chooseAddress(a.id);
      if (ret) leave();
    } catch (e) {
      setError(addressErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (a: SavedAddress) => {
    if (busy) return;
    setError(null);
    setBusy(a.id);
    try {
      await removeAddress(a.id);
      setConfirming(null);
    } catch (e) {
      setError(addressErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const list = loc.addresses;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 14 }]}>
        <PressScale onPress={leave} style={styles.backBtn}><BackIcon size={19} color="#111" stroke={2} /></PressScale>
        <Text style={styles.title}>{ret === '/cart' ? T.choose : T.title}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 15, paddingBottom: insets.bottom + 30 }}>
        {DEMO ? (
          <Text style={styles.note}>{T.preview}</Text>
        ) : !session ? (
          <>
            {loc.guestPin && (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <SmallPin />
                  <Text style={styles.label}>{T.guestPin}</Text>
                </View>
                <Text style={styles.line}>{loc.guestPin.label ?? ''}</Text>
                <View style={styles.actions}>
                  <Pressable onPress={add} hitSlop={6}><Text style={styles.action}>{T.edit}</Text></Pressable>
                </View>
              </View>
            )}
            <Text style={styles.note}>{T.guest}</Text>
            <AddRow onPress={add} />
          </>
        ) : (
          <>
            <AddRow onPress={add} />
            {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
            {!list && loc.loading && [0, 1].map((i) => <Skeleton key={i} h={108} r={14} style={{ marginTop: 12 }} />)}
            {!list && !loc.loading && !!loc.error && (
              <View style={{ alignItems: 'center', marginTop: 24 }}>
                <Text style={styles.note}>{loc.error}</Text>
                <PressScale onPress={() => void loadAddresses(true).catch(() => undefined)} style={styles.retry}>
                  <Text style={styles.retryTxt}>{T.retry}</Text>
                </PressScale>
              </View>
            )}
            {list && !list.length && <Text style={styles.note}>{T.empty}</Text>}
            {list?.map((a) => {
              const on = loc.address?.id === a.id;
              return (
                <Animated.View key={a.id} layout={LinearTransition.duration(160)} exiting={FadeOut.duration(140)}>
                  <Pressable onPress={() => void choose(a)} style={[styles.card, on && styles.cardOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <View style={styles.cardTop}>
                      <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                      <Text style={styles.label}>{a.label}</Text>
                      {a.is_default && <Text style={styles.chip}>{T.isDefault}</Text>}
                      <View style={{ flex: 1 }} />
                      {busy === a.id && <ActivityIndicator size="small" color={C.brandInk} />}
                    </View>
                    <Text style={styles.line} numberOfLines={2}>{addressSummary(a)}</Text>
                    <Text style={styles.who} numberOfLines={1}>{`${a.recipient_name} · ${formatPhone(a.recipient_phone)}`}</Text>
                    {confirming === a.id ? (
                      <Animated.View entering={FadeIn.duration(140)} style={styles.confirm}>
                        <Text style={styles.confirmTxt}>{T.confirm}</Text>
                        <Pressable onPress={() => setConfirming(null)} hitSlop={6}><Text style={styles.action}>{T.cancel}</Text></Pressable>
                        <Pressable onPress={() => void remove(a)} hitSlop={6}>
                          <Text style={[styles.action, { color: C.problem }]}>{busy === a.id ? T.deleting : T.del}</Text>
                        </Pressable>
                      </Animated.View>
                    ) : (
                      <View style={styles.actions}>
                        {on && <Text style={styles.here}>{T.selected}</Text>}
                        <View style={{ flex: 1 }} />
                        <Pressable onPress={() => edit(a)} hitSlop={6}><Text style={styles.action}>{T.edit}</Text></Pressable>
                        <Pressable onPress={() => setConfirming(a.id)} hitSlop={6}><Text style={[styles.action, { color: C.problem }]}>{T.del}</Text></Pressable>
                      </View>
                    )}
                  </Pressable>
                </Animated.View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AddRow({ onPress }: { onPress: () => void }) {
  return (
    <PressScale onPress={onPress} style={styles.addRow} scaleTo={0.97} haptic>
      <View style={styles.plus}><Text style={styles.plusTxt}>+</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.addTxt}>{T.add}</Text>
        <Text style={styles.addSub}>{T.addSub}</Text>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 17, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.line },
  backBtn: {
    width: 31, height: 31, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E6E6E9',
  },
  title: { fontFamily: F.semi, fontSize: 16.7, color: C.brandInk },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  plus: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  plusTxt: { fontFamily: F.semi, fontSize: 20, color: C.brandInk, lineHeight: 22, marginTop: -1 },
  addTxt: { fontFamily: F.semi, fontSize: 14.5, color: C.brandInk },
  addSub: { fontFamily: F.regular, fontSize: 12, color: '#6E6E76', marginTop: 1 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1.5, borderColor: 'transparent' },
  cardOn: { borderColor: C.brandDeep, backgroundColor: '#FFFDF2' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.6, borderColor: '#B4B4BC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.brandInk, backgroundColor: C.brand },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.brandInk },
  label: { fontFamily: F.semi, fontSize: 15, color: '#111' },
  chip: { fontFamily: F.medium, fontSize: 10.5, color: C.brandInk, backgroundColor: C.brandSoft, paddingHorizontal: 7, paddingVertical: 1.5, borderRadius: 8, overflow: 'hidden' },
  line: { fontFamily: F.regular, fontSize: 13, color: '#3A3A40', marginTop: 7, lineHeight: 17 },
  who: { fontFamily: F.regular, fontSize: 12, color: '#6E6E76', marginTop: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 11 },
  here: { fontFamily: F.medium, fontSize: 12, color: C.green },
  action: { fontFamily: F.semi, fontSize: 13, color: C.brandText },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 11, backgroundColor: '#FDECEA', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  confirmTxt: { flex: 1, fontFamily: F.medium, fontSize: 12.5, color: '#3A3A40' },
  note: { fontFamily: F.regular, fontSize: 13, color: '#55555C', marginTop: 16, lineHeight: 18, textAlign: 'center' },
  error: { fontFamily: F.medium, fontSize: 12, color: C.problem, marginTop: 12, lineHeight: 16 },
  retry: { marginTop: 12, height: 38, borderRadius: 19, paddingHorizontal: 18, backgroundColor: C.brand, justifyContent: 'center' },
  retryTxt: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
});
