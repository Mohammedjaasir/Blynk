import { router } from 'expo-router';
import type { Category } from '@/blynk/api/types';
import { destinationHref, type PromoDestination } from '@/blynk/catalog/promoTarget';
import { categoryHref } from '@/blynk/catalog/tree';
import { DEMO } from '@/demo/mode';

/**
 * Open a category: its screen with the sub-category sidebar (/category/<slug>). The design mock
 * (DEMO) keeps the video's aisle intro and store page over its own content.
 */
export const openAisle = (c: Pick<Category, 'slug' | 'name'>) =>
  DEMO
    ? router.push({ pathname: '/opening', params: { id: c.slug, name: c.name } })
    : router.push(categoryHref(c.slug));

/** Follow a promo surface's destination (carousel banner or promo band; promoTarget.ts). */
export const openPromoDestination = (d: PromoDestination) => router.push(destinationHref(d));

/** Back, or Home when there is nothing to go back to (a deep link or a refreshed web page). */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/home'));
