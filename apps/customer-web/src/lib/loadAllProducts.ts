import { getProducts } from '../api/catalog';
import type { Product } from '../api/types';

/** Whole catalogue: limit 100 per page, up to total_pages (max 20). */
export async function loadAllProducts(): Promise<Product[]> {
  const first = await getProducts({ page: 1, limit: 100 });
  let products = first.products;
  for (let page = 2; page <= Math.min(first.pagination.total_pages, 20); page++) {
    products = products.concat((await getProducts({ page, limit: 100 })).products);
  }
  return products;
}
