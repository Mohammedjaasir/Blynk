import { getProducts, getStore } from './catalog';
import * as client from './client';

afterEach(() => vi.restoreAllMocks());

test('getProducts builds the query and returns products + pagination', async () => {
  const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({ products: [], pagination: { page: 1, limit: 40, total: 0, total_pages: 0 } });
  await getProducts({ category_slug: 'dairy-eggs', search: 'milk', page: 2, limit: 40 });
  expect(spy).toHaveBeenCalledWith('/catalog/products?category_slug=dairy-eggs&search=milk&page=2&limit=40');
});

test('getStore hits /store', async () => {
  const spy = vi.spyOn(client, 'apiRequest').mockResolvedValue({});
  await getStore();
  expect(spy).toHaveBeenCalledWith('/store');
});
