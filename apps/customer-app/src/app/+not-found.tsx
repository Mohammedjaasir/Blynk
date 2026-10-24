import { router } from 'expo-router';
import { NOT_FOUND_WORDS as W } from '@/blynk/account/screenWords';
import { Page, StateView } from '@/blynk/ui/kit';

/*
 * An address this app has no screen for (Flutter NotFoundScreen): say so plainly and offer the
 * shop, instead of expo-router's developer "Unmatched route" page.
 */
export default function NotFound() {
  const toShop = () => router.replace('/home');
  return (
    <Page title={W.title} onBack={toShop} scroll={false}>
      <StateView title={W.heading} message={W.message} action={W.action} onAction={toShop} />
    </Page>
  );
}
