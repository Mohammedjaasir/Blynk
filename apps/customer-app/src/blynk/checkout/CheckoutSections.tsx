import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Collapsible } from '@/components/ui';
import { withSpring } from '@/lib/motion';
import { C, F } from '@/lib/theme';
import {
  DETAILS_COPY, RECIPIENT_NAME_MAX, recipientNameError, recipientPhoneError, type CheckoutDetails,
} from './details';
import {
  balanceLine, BIRTHDAY_SUB, birthdayBanner, canRedeem, redeemLine, REFERRAL_SUB, referralLine,
  type Birthday, type PointsProgram, type Referral,
} from './rewards';
import { asapOffered, SLOT_COPY, slotsByDay, type DeliverySlots } from './slots';
import { WALLET_COPY } from '@/blynk/wallet/copy';
import { canUseWallet, walletUseLine, type CheckoutWallet } from '@/blynk/wallet/models';

/*
 * The checkout sections the Flutter shop has and the cart lacked (owner, 2026-10-09..12):
 * the birthday banner, "Delivery time" (slots), "Delivery details" (for someone else, needs
 * help, note for the rider) and the rewards card (referral reward, Use points).
 * Each draws nothing when the server says it does not apply. Pure presentation: the cart owns
 * the state and sends it with the order.
 */

const INK = '#222';
const TEXT = '#333';
const MUTED = '#6E6E76';

/** "Happy birthday! 10% off one order this week": only while the server says eligible. */
export function BirthdayBanner({ birthday }: { birthday: Birthday | null }) {
  if (!birthday?.eligible) return null;
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[s.card, s.bday]} accessibilityRole="summary">
      <Text style={{ fontSize: 22 }}>🎁</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.bdayTitle}>{birthdayBanner(birthday)}</Text>
        <Text style={s.bdaySub}>{BIRTHDAY_SUB}</Text>
      </View>
    </Animated.View>
  );
}

/** A filled vs outline mark (not only a colour) says which choice is picked. */
function Choice({ label, picked, full, onPress, a11y }: { label: string; picked: boolean; full?: boolean; onPress?: () => void; a11y?: string }) {
  const off = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="radio"
      accessibilityState={{ checked: picked, disabled: off }}
      accessibilityLabel={full ? `${a11y ?? label}, ${SLOT_COPY.full}` : (a11y ?? label)}
      style={s.choice}
    >
      <View style={[s.radio, picked && s.radioOn]}>{picked && <View style={s.radioDot} />}</View>
      <Text style={[s.choiceTxt, off && { color: '#A3A5B0' }]}>{label}</Text>
      {full && <Text style={s.full}>{SLOT_COPY.full}</Text>}
    </Pressable>
  );
}

/**
 * "Delivery time": while staff have slots on. ASAP is the default while open; while closed
 * ASAP is not offered and a slot must be picked. A full slot is shown greyed, not pickable.
 */
export function SlotPickerCard({ slots, failed, loading, storeOpen, picked, onPick, onRetry, asapAllowed = true, note }: {
  slots: DeliverySlots | null; failed: boolean; loading: boolean; storeOpen: boolean; picked: string | null;
  onPick: (start: string | null) => void; onRetry: () => void;
  /** False for a cart with a delivery lead time (migration 045): no "As soon as possible". */
  asapAllowed?: boolean;
  /** Shown instead of the closed note when ASAP is not offered ("Delivered from Fri 17 Oct..."). */
  note?: string | null;
}) {
  if (!slots) {
    if (!failed) return null;
    return (
      <View style={[s.card, s.pad]}>
        <Text style={s.head}>{SLOT_COPY.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Text style={[s.muted, { flex: 1 }]}>{SLOT_COPY.loadFailed}</Text>
          <Pressable onPress={onRetry} disabled={loading} hitSlop={8}><Text style={s.link}>Retry</Text></Pressable>
        </View>
      </View>
    );
  }
  if (!slots.enabled) return null;
  const asap = asapAllowed && asapOffered(slots, storeOpen);
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[s.card, s.pad]}>
      <Text style={s.head}>{SLOT_COPY.title}</Text>
      {asap ? (
        <Choice label={SLOT_COPY.asap} picked={picked === null} onPress={() => onPick(null)} />
      ) : (
        <Text style={[s.muted, { marginTop: 6 }]}>{note ?? SLOT_COPY.closedNote}</Text>
      )}
      {!slots.slots.length && !asap && <Text style={[s.muted, { marginTop: 6 }]}>{SLOT_COPY.noSlots}</Text>}
      {slotsByDay(slots.slots).map((g) => (
        <View key={g.day}>
          <Text style={s.day} accessibilityRole="header">{g.day}</Text>
          {g.slots.map((x) => (
            <Choice
              key={x.start}
              label={x.time_label}
              a11y={x.label}
              picked={picked === x.start}
              full={!x.available}
              onPress={x.available ? () => onPick(x.start) : undefined}
            />
          ))}
        </View>
      ))}
    </Animated.View>
  );
}

/** Ink "on" switch (yellow stays for the forward action), as in the Flutter shop. */
function Toggle({ on }: { on: boolean }) {
  const x = useSharedValue(on ? 1 : 0);
  useEffect(() => { x.value = withSpring(on ? 1 : 0, { damping: 16, stiffness: 260 }); }, [on]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 16 }] }));
  return (
    <View style={[s.track, on && { backgroundColor: C.ink, borderColor: C.ink }]}>
      <Animated.View style={[s.knob, knob, !on && { backgroundColor: '#A3A5B0' }]} />
    </View>
  );
}

function Field({ label, value, onChange, error, hint, keyboard, max, multiline }: {
  label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string;
  keyboard?: 'phone-pad' | 'default'; max?: number; multiline?: boolean;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={hint}
        placeholderTextColor="#9A9AA2"
        keyboardType={keyboard ?? 'default'}
        maxLength={max}
        multiline={multiline}
        accessibilityLabel={label}
        style={[s.input, multiline && { height: 58, textAlignVertical: 'top', paddingTop: 8 }, !!error && { borderColor: C.problem }]}
      />
      {!!error && <Text style={s.err}>{error}</Text>}
    </View>
  );
}

/**
 * "Delivery details": For someone else (only while staff allow it). No quick notes or note for
 * the rider any more (owner, 2026-10-19: "dont want this"), so with "For someone else" switched
 * off in Admin / Ops the card is not shown. `showErrors` turns on the receiver checks after a
 * Place order tap (or once a field was touched).
 */
export function DeliveryDetailsCard({ details, setDetails, allowForSomeoneElse, codeToReceiver, showErrors }: {
  details: CheckoutDetails; setDetails: (f: (d: CheckoutDetails) => CheckoutDetails) => void;
  allowForSomeoneElse: boolean; codeToReceiver: boolean; showErrors: boolean;
}) {
  const [touched, setTouched] = useState({ name: false, phone: false });
  if (!allowForSomeoneElse) return null;
  const on = allowForSomeoneElse && details.forSomeoneElse;
  const set = (patch: Partial<CheckoutDetails>) => setDetails((d) => ({ ...d, ...patch }));
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[s.card, s.pad]}>
      <Text style={s.head}>{DETAILS_COPY.title}</Text>
      {allowForSomeoneElse && (
        <>
          <Pressable
            onPress={() => set({ forSomeoneElse: !details.forSomeoneElse })}
            accessibilityRole="switch"
            accessibilityState={{ checked: on }}
            accessibilityLabel={DETAILS_COPY.forSomeoneElse}
            style={s.optRow}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={s.optTitle}>{DETAILS_COPY.forSomeoneElse}</Text>
              <Text style={s.muted}>{DETAILS_COPY.forSomeoneElseSub(codeToReceiver)}</Text>
            </View>
            <Toggle on={on} />
          </Pressable>
          <Collapsible open={on}>
            <View style={{ paddingBottom: 8 }}>
              <Field
                label={DETAILS_COPY.nameLabel}
                value={details.recipientName}
                max={RECIPIENT_NAME_MAX}
                onChange={(v) => { setTouched((t) => ({ ...t, name: true })); set({ recipientName: v }); }}
                error={(touched.name || showErrors) ? recipientNameError(details.recipientName) : null}
              />
              <Field
                label={DETAILS_COPY.phoneLabel}
                hint={DETAILS_COPY.phoneHint}
                keyboard="phone-pad"
                max={16}
                value={details.recipientPhone}
                onChange={(v) => { setTouched((t) => ({ ...t, phone: true })); set({ recipientPhone: v }); }}
                error={(touched.phone || showErrors) ? recipientPhoneError(details.recipientPhone) : null}
              />
              <Text style={[s.muted, { marginTop: 6 }]}>{DETAILS_COPY.onlyThisOrder}</Text>
            </View>
          </Collapsible>
        </>
      )}
    </Animated.View>
  );
}

/**
 * Referral reward, "Use points" and "Use wallet balance" (both default off): only for what
 * applies. The points this order earns are one quiet line in the bill, for guests too (cart.tsx,
 * pointsPromo.ts). The wallet pays after the coupon and points (docs/api/wallet.md).
 */
export function RewardsCard({ referral, points, usePoints, onUsePoints, redeem, wallet, useWallet = false, onUseWallet, walletUsed = 0, walletDue = 0 }: {
  referral: Referral | null; points: PointsProgram | null; usePoints: boolean; onUsePoints: (on: boolean) => void;
  redeem: { points: number; value: number };
  /** checkout-info's wallet block (null = no wallet on this server). */
  wallet?: CheckoutWallet | null;
  useWallet?: boolean;
  onUseWallet?: (on: boolean) => void;
  /** The estimated amount the wallet pays, and what was due before it. */
  walletUsed?: number;
  walletDue?: number;
}) {
  const showReferral = !!referral?.available;
  const redeemable = canRedeem(points);
  const walletOn = canUseWallet(wallet) && !!onUseWallet;
  if (!showReferral && !redeemable && !walletOn) return null;
  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[s.card, s.pad, { gap: 12 }]}>
      {showReferral && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Text style={{ fontSize: 16 }}>🎟️</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.optTitle, { color: C.green }]}>{referralLine(referral!)}</Text>
            <Text style={s.muted}>{REFERRAL_SUB}</Text>
          </View>
        </View>
      )}
      {redeemable && (
        <View>
          <Pressable
            onPress={() => onUsePoints(!usePoints)}
            accessibilityRole="switch"
            accessibilityState={{ checked: usePoints }}
            accessibilityLabel="Use points"
            style={[s.optRow, { paddingVertical: 0 }]}
          >
            <Text style={{ fontSize: 16, marginRight: 10 }}>⭐</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.optTitle}>{balanceLine(points!)}</Text>
              <Text style={s.muted}>Use points</Text>
            </View>
            <Toggle on={usePoints} />
          </Pressable>
          {usePoints && (
            <Text style={[s.muted, { marginTop: 4 }, redeem.points > 0 && { color: C.green }]}>{redeemLine(redeem)}</Text>
          )}
        </View>
      )}
      {walletOn && (
        <View>
          <Pressable
            onPress={() => onUseWallet!(!useWallet)}
            accessibilityRole="switch"
            accessibilityState={{ checked: useWallet }}
            accessibilityLabel={WALLET_COPY.toggleLabel(wallet!.balance)}
            style={[s.optRow, { paddingVertical: 0 }]}
          >
            <Text style={{ fontSize: 16, marginRight: 10 }}>👛</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.optTitle}>{WALLET_COPY.toggleLabel(wallet!.balance)}</Text>
              <Text style={s.muted}>{WALLET_COPY.toggleSub}</Text>
            </View>
            <Toggle on={useWallet} />
          </Pressable>
          {useWallet && (
            <Text style={[s.muted, { marginTop: 4 }, walletUsed > 0 && { color: C.green }]}>{walletUseLine(wallet!, walletUsed, walletDue)}</Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 15, marginBottom: 15 },
  pad: { paddingHorizontal: 15, paddingVertical: 14 },
  head: { fontFamily: F.semi, fontSize: 12.5, color: '#7A7A82', letterSpacing: 1.5, textTransform: 'uppercase' },
  muted: { fontFamily: F.regular, fontSize: 12, color: MUTED, lineHeight: 17 },
  link: { fontFamily: F.bold, color: C.brandText, fontSize: 13 },
  bday: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15, paddingVertical: 12, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandSoft },
  bdayTitle: { fontFamily: F.semi, fontSize: 13.5, color: C.brandInk },
  bdaySub: { fontFamily: F.regular, fontSize: 12, color: C.brandText, marginTop: 1 },
  choice: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 12 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.6, borderColor: '#A3A5B0', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.ink },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.ink },
  choiceTxt: { flex: 1, fontFamily: F.regular, fontSize: 13.5, color: TEXT },
  full: { fontFamily: F.medium, fontSize: 11.5, color: '#A3A5B0' },
  day: { fontFamily: F.medium, fontSize: 12, color: MUTED, marginTop: 10, marginBottom: 2 },
  optRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  optTitle: { fontFamily: F.semi, fontSize: 13.5, color: INK },
  track: { width: 38, height: 22, borderRadius: 11, borderWidth: 1.2, borderColor: '#D5D5DC', backgroundColor: '#EDEDF0', padding: 2 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
  fieldLabel: { fontFamily: F.medium, fontSize: 12, color: MUTED, marginBottom: 4 },
  input: {
    height: 40, borderRadius: 10, borderWidth: 1.2, borderColor: '#E2E2E6', paddingHorizontal: 12,
    fontFamily: F.medium, fontSize: 13.5, color: INK, outlineStyle: 'none',
  } as object,
  err: { fontFamily: F.medium, fontSize: 11.5, color: C.problem, marginTop: 3 },
});
