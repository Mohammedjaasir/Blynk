import { apiRequest } from './client';
import type { Product, Category, HomeGroup, Promotion, Combo, Pagination, StoreInfo } from './types';

export interface ProductQuery { category_slug?: string; search?: string; on_offer?: boolean; page?: number; limit?: number }

export function getProducts(q: ProductQuery = {}) {
  const p = new URLSearchParams();
  if (q.category_slug) p.set('category_slug', q.category_slug);
  if (q.search) p.set('search', q.search);
  if (q.on_offer) p.set('on_offer', 'true');
  p.set('page', String(q.page ?? 1));
  p.set('limit', String(q.limit ?? 40));
  return apiRequest<{ products: Product[]; pagination: Pagination }>(`/catalog/products?${p.toString()}`);
}
export const getProduct = (id: string) => apiRequest<{ product: Product }>(`/catalog/products/${encodeURIComponent(id)}`);
export const getCategories = () => apiRequest<{ categories: Category[] }>('/catalog/categories');
export const getHomeGroups = () => apiRequest<{ groups: HomeGroup[] }>('/catalog/home-groups');
export const getPromotions = () => apiRequest<{ promotions: Promotion[] }>('/promotions');
export const getCombos = () => apiRequest<{ combos: Combo[] }>('/combos');
export const getStore = () => apiRequest<StoreInfo>('/store');
