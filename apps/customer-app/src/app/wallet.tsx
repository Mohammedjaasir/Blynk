import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/blynk/auth/session';
import { formatLkr } from '@/blynk/lib/money';
import { formatPointsDate } from '@/blynk/rewards/models';
import { Body, Button, ListSkeleton, Notice, Page, SectionTitle, StateView } from '@/blynk/ui/kit';
import { openSignIn } from '@/blynk/ui/signIn';
import { useLoad } from '@/blynk/ui/useLoad';
import { fetchWallet, WALLET_PAGE_SIZE } from '@/blynk/wallet/api';
import { WALLET_COPY } from '@/blynk/wallet/copy';
import {
  entryAmount, hasMore, kindLabel, mergeWalletPage, walletRules, walletVisible, type WalletEntry, type WalletInfo,
} from '@/blynk/wallet/models';
import { DEMO } from '@/demo/mode';
import { DEMO_WALLET } from '@/demo/wallet';
import { C, F } from '@/lib/theme';

/*
 * Blynk Wallet (docs/api/wallet.md, owner 2026-10-15): the balance, the short rules (it pays for
 * a later order, never withdrawn as cash, the expiry note) and the history from GET /me/wallet,
 * newest first, a page at a time. Refunds land here; the customer never tops it up.
 */
export default function Wallet() {
  const session = useSession();
  const load = useLoad((signal) => fetchWallet(1, WALLET_PAGE_SIZE, signal), [session?.user.id], !!session && !DEMO);
  // later pages appended to the first (kept with the first page they belong to)
  const [more, setMore] = useState<{ base: WalletInfo; info: WalletInfo } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const first = DEMO ? DEMO_WALLET : load.data;
  const info = more && more.base === first ? more.info : first;

  const loadMore = async () => {
    if (!info || !first || moreBusy || DEMO) return;
    setMoreBusy(true);
    setMoreFailed(false);
    try {
      const next = await fetchWallet(info.pagination.page + 1, WALLET_PAGE_SIZE);
      setMore({ base: first, info: mergeWalletPage(info, next) });
    } catch {
      setMoreFailed(true);
    } finally {
      setMoreBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!DEMO && !session) body = <StateView title={WALLET_COPY.signedOutTitle} message={WALLET_COPY.signedOutSub} action={WALLET_COPY.logIn} onAction={openSignIn} />;
  else if (!info) body = load.error
    ? <StateView title={WALLET_COPY.loadFailedTitle} message={WALLET_COPY.loadFailedSub} action={WALLET_COPY.tryAgain} onAction={load.reload} />
    : <ListSkeleton rows={3} h={70} />;
  else if (!walletVisible(info)) body = <StateView title={WALLET_COPY.offTitle} message={WALLET_COPY.offSub} />;
  else {
    body = (
      <View>
        {DEMO && <View style={{ marginBottom: 12 }}><Notice tone="neutral">{WALLET_COPY.demoNote}</Notice></View>}
        <View style={s.balance} accessible accessibilityLabel={`${WALLET_COPY.balanceLabel}: ${formatLkr(info.balance)}`}>
          <Text style={s.balanceLabel}>{WALLET_COPY.balanceLabel}</Text>
          <Text style={s.balanceTxt}>{formatLkr(info.balance)}</Text>
        </View>
        {!info.enabled && <View style={{ marginTop: 12 }}><Notice tone="neutral">{WALLET_COPY.paused}</Notice></View>}
        <View style={{ marginTop: 22 }}>
          <SectionTitle>{WALLET_COPY.howTitle}</SectionTitle>
          {walletRules(info).map((line) => <Body key={line} sub style={{ marginBottom: 4 }}>{line}</Body>)}
        </View>
        <View style={{ marginTop: 22 }}>
          <SectionTitle>{WALLET_COPY.historyTitle}</SectionTitle>
          {info.entries.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.rowLabel}>{WALLET_COPY.empty}</Text>
              <Text style={s.rowSub}>{WALLET_COPY.emptySub}</Text>
            </View>
          ) : info.entries.map((e) => <EntryRow key={e.id} e={e} />)}
          {hasMore(info) && !DEMO && (
            <Button label={moreBusy ? WALLET_COPY.loadingMore : WALLET_COPY.showMore} kind="quiet" small busy={moreBusy} onPress={() => void loadMore()} style={{ marginTop: 4 }} />
          )}
          {moreFailed && <Text style={[s.rowSub, { color: C.problem, textAlign: 'center' }]}>{WALLET_COPY.loadFailedSub}</Text>}
        </View>
      </View>
    );
  }
  return <Page title={WALLET_COPY.title}>{body}</Page>;
}

/** One history line: what happened, when and for which order, the reason, and +/- the amount. */
function EntryRow({ e }: { e: WalletEntry }) {
  const details = [
    e.createdAt ? formatPointsDate(e.createdAt) : null,
    e.orderNumber ? WALLET_COPY.orderRef(e.orderNumber) : null,
    e.amount > 0 && e.expiresAt ? WALLET_COPY.expires(formatPointsDate(e.expiresAt)) : null,
  ].filter(Boolean).join(' · ');
  const credit = e.amount > 0;
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{kindLabel(e.kind)}</Text>
        {!!e.reason && <Text style={s.reason}>{e.reason}</Text>}
        {!!details && <Text style={s.rowSub}>{details}</Text>}
      </View>
      <Text style={[s.rowLabel, { color: credit ? C.greenDark : C.ink }]}>{entryAmount(e.amount)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  balance: { backgroundColor: C.brand, borderRadius: 18, padding: 18 },
  balanceLabel: { fontFamily: F.medium, fontSize: 13, color: C.brandInk, opacity: 0.75 },
  balanceTxt: { fontFamily: F.bold, fontSize: 28, color: C.brandInk, marginTop: 2, letterSpacing: -0.3 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 8 },
  empty: { backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center' },
  rowLabel: { fontFamily: F.semi, fontSize: 14, color: C.ink },
  reason: { fontFamily: F.regular, fontSize: 12.5, color: C.text, marginTop: 2, lineHeight: 17 },
  rowSub: { fontFamily: F.regular, fontSize: 12, color: C.sub, marginTop: 2 },
});
