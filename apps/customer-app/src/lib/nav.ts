import { router } from 'expo-router';
import type { Category } from '@/blynk/api/types';

/** Open an aisle through the short Blynk aisle intro. */
export const openAisle = (c: Pick<Category, 'slug' | 'name'>) =>
  router.push({ pathname: '/opening', params: { id: c.slug, name: c.name } });

/** Back, or Home when there is nothing to go back to (a deep link or a refreshed web page). */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/home'));
