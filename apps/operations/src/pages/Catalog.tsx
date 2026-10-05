import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { catalog, dental, inventory as inventoryApi } from '../api/resources';
import { PageHeader } from '../components/Layout';
import { isOrderableButOut, stockState } from '../lib/inventory';

/**
 * Catalog hub (task F5, plan §12) - full rewrite in place of F1's flat
 * placeholder, the same "replace the stub directly" move F3 made for
 * `pages/Orders.tsx` (F1's own report D4 designed every tab placeholder to
 * be replaced this way). F1's report (D5) left the Catalog tab's internal
 * structure open ("one grouping entry point... your call, document the
 * decision"); this task keeps the single top-level tab (matching the plan's
 * 5-tab nav diagram) and nests the three real sub-screens under it as their
 * own routes - `src/pages/Catalog/{Products,ProductForm,Categories,
 * Promotions}.tsx` - the same "sibling nested route" pattern F3 used for
 * `orders/:id` and F4 used for `delivery/:id`. Kept as a flat file (not
 * `pages/Catalog/index.tsx`) deliberately, so `import ... from
 * './pages/Catalog'` in `App.tsx` stays unambiguous alongside the new
 * `pages/Catalog/` folder - see this task's report for the file-naming
 * collision that ruled out an index file here.
 *
 * Counts are real (each card's own list call), never fabricated (common.md
 * rule 7); a card whose count fails to load just shows no number rather
 * than a guessed one.
 *
 * Task F6 adds a fourth card, "Inventory" - stock/ledger/sourcing/suppliers
 * (plan §13, common.md's OPS-04 scope decision), keeping F1's D5 choice of a
 * single Catalog tab grouping every catalog-adjacent domain rather than
 * adding a sixth top-level tab. Its count is the number of products that
 * need attention right now (low, out, or orderable-but-out) - the same
 * "worst first" figure Inventory's own Overview leads with - not a total
 * product count, which would just duplicate the Products card.
 *
 * Task F8 adds a fifth card, "Dental" - clinics/doctors/pairings/
 * availability/blocked-dates (plan §15-19), the last domain this hub's own
 * doc comment already named as planned ("products/categories/promotions/
 * inventory/dental" above) - same grouping choice, not a new top-level tab.
 * Its count is the clinic count (the top of that domain's own hub,
 * `pages/Dental/Overview.tsx`), read the same way every other card here
 * reads its own real number.
 */
export function Catalog() {
  const [productCount, setProductCount] = useState<number | null>(null);
  const [categoryCount, setCategoryCount] = useState<number | null>(null);
  const [groupCount, setGroupCount] = useState<number | null>(null);
  const [promotionCount, setPromotionCount] = useState<number | null>(null);
  const [inventoryAttentionCount, setInventoryAttentionCount] = useState<number | null>(null);
  const [dentalClinicCount, setDentalClinicCount] = useState<number | null>(null);

  useEffect(() => {
    // `GET /admin/products` has no separate count endpoint (its response
    // carries `{page, limit}` only, not a `total` - see resources.ts's
    // `products.list` doc comment), so this reads the same list the
    // Products screen itself loads and counts the rows - a real number, not
    // a guess, at the cost of one extra request per hub visit.
    void catalog.categories.list().then((rows) => setCategoryCount(rows.length)).catch(() => setCategoryCount(null));
    void catalog.categoryGroups.list().then((r) => setGroupCount(r.groups.length)).catch(() => setGroupCount(null));
    void catalog.promotions.list().then((rows) => setPromotionCount(rows.length)).catch(() => setPromotionCount(null));
    void catalog.products
      .list({ limit: 200 })
      .then((rows) => setProductCount(rows.length))
      .catch(() => setProductCount(null));
    void inventoryApi.stock
      .list({ low_stock_only: true, limit: 100 })
      .then((r) => setInventoryAttentionCount(r.inventory.filter((row) => stockState(row).kind !== 'IN_STOCK' || isOrderableButOut(row)).length))
      .catch(() => setInventoryAttentionCount(null));
    void dental.clinics.list().then((rows) => setDentalClinicCount(rows.length)).catch(() => setDentalClinicCount(null));
  }, []);

  return (
    <div className="page">
      <PageHeader title="Catalog" description="Products, categories, Home promotions, inventory and dental clinics." />
      <ul className="cat-hub">
        <li>
          <Link className="cat-hub__card" to="/catalog/products">
            <span className="cat-hub__title">Products</span>
            <span className="cat-hub__count">{productCount === null ? '—' : productCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/categories">
            <span className="cat-hub__title">Categories</span>
            <span className="cat-hub__count">{categoryCount === null ? '—' : categoryCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/category-groups">
            <span className="cat-hub__title">Category groups</span>
            <span className="cat-hub__count">{groupCount === null ? '—' : groupCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/promotions">
            <span className="cat-hub__title">Home promotions</span>
            <span className="cat-hub__count">{promotionCount === null ? '—' : promotionCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/inventory">
            <span className="cat-hub__title">Inventory</span>
            <span className="cat-hub__count">{inventoryAttentionCount === null ? '—' : inventoryAttentionCount}</span>
          </Link>
        </li>
        <li>
          <Link className="cat-hub__card" to="/catalog/dental">
            <span className="cat-hub__title">Dental</span>
            <span className="cat-hub__count">{dentalClinicCount === null ? '—' : dentalClinicCount}</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
