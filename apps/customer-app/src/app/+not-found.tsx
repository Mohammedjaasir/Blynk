import { router } from 'expo-router';
import { Page, StateView } from '@/blynk/ui/kit';

/*
 * An address this app has no screen for (Flutter NotFoundScreen): say so plainly and offer the
 * shop, instead of expo-router's developer "Unmatched route" page.
 */
export default function NotFound() {
  const toShop = () => router.replace('/home');
  return (
    <Page title="Not found" onBack={toShop} scroll={false}>
      <StateView title="This page isn't available" message="It may have moved or no longer exists." action="Go to the shop" onAction={toShop} />
    </Page>
  );
}
