import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { trackShare } from '@/blynk/analytics/track';
import { useSession } from '@/blynk/auth/session';
import { applyReferralCode, fetchReferral } from '@/blynk/rewards/api';
import { creditLabel, referredByText, rewardDescription, type ReferralInfo } from '@/blynk/rewards/models';
import { referralShareText } from '@/blynk/share/links';
import { copyText, shareText } from '@/blynk/share/share';
import { Body, Button, Card, Field, ListSkeleton, Page, SectionTitle, StateView, useToast } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { useLoad } from '@/blynk/ui/useLoad';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * Refer a friend (Flutter ReferFriendScreen, owner 2026-10-10): the customer's own code with
 * Share / Copy, the reward in one sentence (GET /me/referral), friends joined and rewards earned,
 * rewards waiting for the next order, who invited them, and - while the server allows it -
 * "Have a friend's code?" (POST /me/referral/apply).
 */
export default function Refer() {
  const session = useSession();
  const [toast, showToast] = useToast();
  const load = useLoad(() => fetchReferral(), [session?.user.id], !!session && !DEMO);
  const info = load.data;
  const failed = !!load.error;

  let body: React.ReactNode;
  if (DEMO) body = <StateView title="Refer a friend" message="Referral codes show here once the shop is live." />;
  else if (!session) body = <StateView title="Log in to refer a friend" message="Your referral code is part of your account." action="Log in" onAction={openSignIn} />;
  else if (!info) body = failed
    ? <StateView title="Couldn't load your referral code" message="Check your connection and try again." action="Try again" onAction={load.reload} />
    : <ListSkeleton rows={3} h={110} />;
  else if (!info.enabled) body = <StateView title="Not available right now" message="Refer a friend isn't running at the moment. Check back later." />;
  else body = <Details info={info} onApplied={(text) => { showToast(text); load.reload(); }} toast={showToast} />;

  return (
    <View style={{ flex: 1 }}>
      <Page title="Refer a friend">{body}</Page>
      {toast}
    </View>
  );
}

function Details({ info, onApplied, toast }: { info: ReferralInfo; onApplied: (text: string) => void; toast: (m: string) => void }) {
  const share = async () => {
    const r = await shareText(referralShareText(info.code), 'Join me on Blynk');
    trackShare(r, 'referral');
    if (r === 'copied') toast('Code copied');
  };
  const copy = async () => toast((await copyText(info.code)) ? 'Code copied' : "Couldn't copy the code");
  return (
    <View>
      {info.reward && (
        <View style={{ marginBottom: 18 }}>
          <Text style={s.title}>Give a reward, get a reward</Text>
          <Body sub style={{ marginTop: 6 }}>{rewardDescription(info.reward)}</Body>
        </View>
      )}
      {!!info.code && (
        <Card>
          <Text style={s.label}>Your code</Text>
          <Text style={s.code} selectable accessibilityLabel={`Your code ${info.code.split('').join(' ')}`}>{info.code}</Text>
          <Button label="Share your code" onPress={() => void share()} style={{ marginTop: 14 }} />
          <Button label="Copy code" kind="quiet" onPress={() => void copy()} style={{ marginTop: 4 }} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Stat value={info.invitedCount} label="Friends joined" />
        <Stat value={info.rewardedCount} label="Rewards earned" />
      </View>
      {info.credits.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <SectionTitle>Waiting for your next order</SectionTitle>
          {info.credits.map((c, i) => <Body key={i} style={{ marginBottom: 4 }}>•  {creditLabel(c)}</Body>)}
          <Body sub>Taken off automatically when it is your biggest saving.</Body>
        </View>
      )}
      {info.referredBy && <Body sub style={{ marginTop: 22 }}>{referredByText(info.referredBy)}</Body>}
      {info.canApplyCode && <ApplyField onApplied={onApplied} />}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

function ApplyField({ onApplied }: { onApplied: (text: string) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await applyReferralCode(code);
    setBusy(false);
    if (out.ok) { setCode(''); onApplied(out.text); } else setError(out.text);
  };
  return (
    <Card style={{ marginTop: 22 }}>
      <Text style={s.rowLabel}>Have a friend&apos;s code?</Text>
      <Field
        label="Referral code"
        value={code}
        onChange={(t) => { setCode(t.toUpperCase()); setError(null); }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={32}
        error={error}
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={() => void apply()}
      />
      <Button label="Apply" kind="secondary" busy={busy} onPress={() => void apply()} style={{ marginTop: 12 }} />
    </Card>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: F.bold, fontSize: 20, color: C.ink },
  label: { fontFamily: F.regular, fontSize: 12.5, color: C.sub },
  code: { fontFamily: F.black, fontSize: 30, color: C.ink, letterSpacing: 2, marginTop: 4 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 12 },
  statValue: { fontFamily: F.bold, fontSize: 22, color: C.ink },
  rowLabel: { fontFamily: F.semi, fontSize: 15, color: C.ink },
});
