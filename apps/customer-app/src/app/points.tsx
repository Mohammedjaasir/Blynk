import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/blynk/auth/session';
import { useStore } from '@/blynk/store/StoreContext';
import { POINTS_COPY, pointsRuleOf } from '@/blynk/store/pointsPromo';
import { fetchPoints } from '@/blynk/rewards/api';
import { entryLabel, entryPoints, formatPointsDate, howItWorks, pointsBalanceText } from '@/blynk/rewards/models';
import { REWARD_WORDS as W } from '@/blynk/rewards/words';
import { Body, ListSkeleton, Page, SectionTitle, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { useLoad } from '@/blynk/ui/useLoad';
import { DEMO } from '@/demo/mode';
import { C, F } from '@/lib/theme';

/*
 * Blynk Points (Flutter PointsHistoryScreen, owner 2026-10-10): the balance and what it is worth,
 * "How it works" from the programme's numbers, and the history (GET /me/points).
 */
export default function Points() {
  const session = useSession();
  const load = useLoad(() => fetchPoints(), [session?.user.id], !!session && !DEMO);
  const info = load.data;
  const failed = !!load.error;
  // a guest hears the earn rule while points are on (GET /store points_program)
  const rule = pointsRuleOf(useStore());

  let body: React.ReactNode;
  if (DEMO) body = <StateView title={W.pointsTitle} message={W.pointsDemo} />;
  else if (!session) body = <StateView title={W.pointsLogIn} message={rule ? POINTS_COPY.guestHow(rule) : undefined} action={W.logIn} onAction={openSignIn} />;
  else if (!info) body = failed
    ? <StateView title={W.pointsLoadFailed} message={W.loadFailedSub} action={W.tryAgain} onAction={load.reload} />
    : <ListSkeleton rows={3} h={70} />;
  else if (!info.enabled) body = <StateView title={W.notAvailable} message={W.pointsOff} />;
  else {
    const how = info.program ? howItWorks(info.program) : [];
    body = (
      <View>
        <View style={s.balance}><Text style={s.balanceTxt}>{pointsBalanceText(info.balance, info.valueLkr)}</Text></View>
        {how.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <SectionTitle>{W.howTitle}</SectionTitle>
            {how.map((line) => <Body key={line} sub style={{ marginBottom: 4 }}>{line}</Body>)}
          </View>
        )}
        <View style={{ marginTop: 22 }}>
          <SectionTitle>{W.historyTitle}</SectionTitle>
          {info.history.length === 0 ? (
            <Body sub>{W.pointsEmpty}</Body>
          ) : info.history.map((e) => {
            const details = [
              e.createdAt ? formatPointsDate(e.createdAt) : null,
              e.kind === 'EARN' && e.expiresAt ? W.expires(formatPointsDate(e.expiresAt)) : null,
            ].filter(Boolean).join(' · ');
            return (
              <View key={e.id} style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{entryLabel(e)}</Text>
                  {!!details && <Text style={s.rowSub}>{details}</Text>}
                </View>
                <Text style={[s.rowLabel, { color: e.points > 0 ? C.greenDark : C.ink }]}>{entryPoints(e.points)}</Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }
  return <Page title={W.pointsTitle}>{body}</Page>;
}

const s = StyleSheet.create({
  balance: { backgroundColor: C.brand, borderRadius: 18, padding: 18 },
  balanceTxt: { fontFamily: F.bold, fontSize: 20, color: C.brandInk },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8 },
  rowLabel: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2 },
});
