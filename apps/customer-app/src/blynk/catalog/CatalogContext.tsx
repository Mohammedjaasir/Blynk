import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cartActions } from '@/lib/cart';
import { getCategories, getHomeGroups, getPromotions } from '../api/catalog';
import { ApiError } from '../api/client';
import type { Category, HomeGroup, Product, Promotion } from '../api/types';
import { ancestorsOf, topLevelOf } from '../lib/categories';
import { startCatalogLive } from '../lib/catalogLive';
import { loadAllProducts } from '../lib/loadAllProducts';
import { effectivePrice } from '../lib/pricing';
import { buildCategoryTree, type MainNode } from './tree';
import { appHidden } from '../lib/visibility';
import { DEMO } from '@/demo/mode';

export interface CatalogData {
  products: Product[];
  /** Top-level aisles in Admin's home-group order. */
  aisles: Category[];
  /** Every category (sub-categories included). */
  categories: Category[];
  promotions: Promotion[];
  /** GET /catalog/home-groups as sent: the Mains with their top-level category tiles. */
  groups: HomeGroup[];
  /** Main -> Category -> Sub-category (docs/api/catalog-tools.md), for Home and the categories screen. */
  tree: MainNode[];
  /** Any category id -> its top-level aisle id. */
  topOf: (id: string) => string;
  /** Any category id -> its chain up to the top level, nearest first. */
  chainOf: (id: string) => string[];
}

async function loadAll(): Promise<CatalogData> {
  const products = await loadAllProducts();
  const [{ groups }, { promotions }, all] = await Promise.all([
    getHomeGroups(),
    getPromotions().catch(() => ({ promotions: [] as Promotion[] })),
    getCategories().then((r) => r.categories).catch(() => [] as Category[]),
  ]);
  const aisles: Category[] = groups.flatMap((g) => g.categories);
  // Home groups list top-level categories only; products can sit in a child category, so roll them up.
  const categories = all.length ? all : aisles;
  return {
    products, aisles, categories, promotions, groups, tree: buildCategoryTree(groups, categories),
    topOf: topLevelOf(categories), chainOf: ancestorsOf(categories),
  };
}

interface CatalogApi {
  data: CatalogData | null;
  error: ApiError | null;
  /** Reload now. Resolves false when that reload failed. */
  refresh: () => Promise<boolean>;
}

const Ctx = createContext<CatalogApi>({ data: null, error: null, refresh: async () => false });

/** One shared catalogue for every screen: loaded once, refreshed live (SSE / 30 s poll), and the cart reconciled each time. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    if (DEMO) return true;
    const n = ++seq.current;
    try {
      const d = await loadAll();
      if (n !== seq.current) return true; // a newer request is in flight; drop the stale answer
      setData(d);
      setError(null);
      cartActions.reconcileWith(d.products);
      return true;
    } catch (e) {
      if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError('Something went wrong. Please try again.', 0));
      return false;
    }
  }, []);
  useEffect(() => {
    if (DEMO) return; // design mock: screens read src/demo/*, nothing is fetched
    void Promise.resolve().then(refresh); // first load, off the effect's synchronous path
    return startCatalogLive(() => void refresh(), appHidden);
  }, [refresh]);
  const api = useMemo(() => ({ data, error, refresh }), [data, error, refresh]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useCatalog = () => useContext(Ctx);

/** Products in an aisle or any of its sub-categories. */
export function productsIn(data: CatalogData, categoryId: string): Product[] {
  return data.products.filter((p) => data.chainOf(p.category_id).includes(categoryId));
}

/** Lowest effective price among available products, or null when there are none. */
export function minPrice(products: Product[]): number | null {
  const prices = products.filter((p) => p.is_available).map((p) => effectivePrice(p));
  return prices.length ? Math.min(...prices) : null;
}
