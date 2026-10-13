import { router } from 'expo-router';
import type { Product } from '@/blynk/api/types';
import { rememberProduct } from './productCache';

/** Open a product's page (`/p/<id>`, the same path a shared link opens). */
export function openProduct(p: Product) {
  rememberProduct(p);
  router.push({ pathname: '/p/[id]', params: { id: p.id } });
}
