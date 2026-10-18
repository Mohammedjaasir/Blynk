import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  categories as categoriesApi,
  inventory as inventoryApi,
  products as productsApi,
  settings as settingsApi,
} from '../api/resources';
import type { Category, PricingMode, PricingSource, SetStockInput, StaffStock, StaffVariant } from '../api/types';
import { categoryOptions } from '../lib/categoryTree';
import { ImageUploader } from '../components/ImageUploader';
import { ProductVariants, StockFigures, type VariantPricingContext } from '../components/ProductVariants';
import { Switch } from '../components/Switch';
import { PageHeader } from '../components/Layout';
import { ApiError } from '../api/client';
import { Field, Spinner, useToast } from '../components/ui';
import { errorMessage, splitServerErrors } from '../lib/apiErrors';
import { colomboDate, formatDay } from '../lib/coupons';
import { useImageCleanup } from '../lib/imageCleanup';
import { formatMoney } from '../lib/orders';
import { MAX_LEAD_DAYS, parseWhole } from '../lib/stock';
import {
  MAX_SELLING_PRICE,
  capAtMrp,
  formatLkr,
  formatPercent,
  inheritedMarkup,
  markupSourceText,
  mrpCappedNote,
  parseMrpInput,
  previewPrice,
  round2 as roundCents,
  type InheritedMarkup,
  type PricePreview,
} from '../lib/pricing';

/** The API's limits (catalog.schema.ts, NUMERIC(5,2) and NUMERIC(10,2)). */
export const MAX_MARKUP_PERCENT = 999.99;
export const MAX_PURCHASE_COST = 99_999_999.99;

/** Fields with an inline error slot; a server error on one shows there. */
const INLINE_FIELDS = [
  'category_id',
  'name',
  'sku',
  'unit',
  'purchase_cost',
  'custom_markup_percent',
  'fixed_selling_price',
  'mrp',
  'offer_price',
  'offer_ends_at',
  'delivery_lead_days',
] as const;

/**
 * Offer end (owner, 2026-10-09): the owner picks a day and the offer runs to
 * the end of that day in Colombo.
 */
export const offerEndOf = (date: string) => `${date}T23:59:59+05:30`;

/**
 * How the offer is typed (owner, 2026-10-10): 'price' = the new price, 'off'
 * = LKR taken off the selling price. Only the resulting price is sent and
 * stored, so a later cost or markup change keeps that stored offer price
 * (as today) - it is not re-derived from the amount off.
 */
type OfferMode = 'price' | 'off';
const OFFER_MODES: Array<{ value: OfferMode; label: string }> = [
  { value: 'price', label: 'New price' },
  { value: 'off', label: 'LKR off' },
];
/**
 * How the selling price is set (migration 044; owner, 2026-10-13): Markup =
 * cost + a markup % (the product's own, else inherited); Fixed price = the
 * typed price exactly.
 */
const PRICING_MODES: Array<{ value: PricingMode; label: string }> = [
  { value: 'MARKUP', label: 'Markup' },
  { value: 'FIXED', label: 'Fixed price' },
];
const MONEY_INPUT = /^\d+(\.\d{1,2})?$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** 50 -> "50", 49.5 -> "49.50": what goes back into an input. */
const moneyInput = (n: number) => n.toFixed(2).replace(/\.00$/, '');

/** The offer as the backend stores it, for "what changed" on save. */
interface StoredOffer {
  price: number | null;
  endsAt: string | null;
}

interface FormState {
  category_id: string;
  name: string;
  sku: string;
  unit: string;
  pack_size: string;
  barcode: string;
  description: string;
  image_url: string | null;
  purchase_cost: string;
  /** Markup | Fixed price (migration 044). */
  pricing_mode: PricingMode;
  custom_markup_percent: string;
  /** The fixed selling price as typed (Fixed price mode). */
  fixed_selling_price: string;
  /** MRP (migration 048) as typed; blank = none. The selling price is capped at it. */
  mrp: string;
  /** Offer price (owner, 2026-10-09); blank = no offer. */
  offer_price: string;
  /** YYYY-MM-DD in Colombo; blank = no end date. */
  offer_ends_on: string;
  /** "New price | LKR off" (owner, 2026-10-10); a stored offer opens as 'price'. */
  offer_mode: OfferMode;
  /** LKR off as typed, used when offer_mode is 'off'. */
  offer_off: string;
  /** Show the struck "was" price and the saving in the app (migration 050; owner, 2026-10-18). */
  show_offer_cut: boolean;
  is_available: boolean;
  is_active: boolean;
  /** Whole days 0..30 before it can be delivered (migration 045); '0' = same day. */
  delivery_lead_days: string;
  /** The product's own stock (only without variants; migration 045). */
  stock_tracked: boolean;
  stock_count: string;
  stock_threshold: string;
  stock_reason: string;
}

const EMPTY: FormState = {
  category_id: '',
  name: '',
  sku: '',
  unit: '',
  pack_size: '',
  barcode: '',
  description: '',
  image_url: null,
  purchase_cost: '',
  pricing_mode: 'MARKUP',
  custom_markup_percent: '',
  fixed_selling_price: '',
  mrp: '',
  offer_price: '',
  offer_ends_on: '',
  offer_mode: 'price',
  offer_off: '',
  show_offer_cut: true,
  is_available: true,
  is_active: true,
  delivery_lead_days: '0',
  stock_tracked: false,
  stock_count: '',
  stock_threshold: '5',
  stock_reason: '',
};

/** The server's low-stock level when none was set. */
const DEFAULT_LOW_STOCK = 5;

/** The saved product's pricing, so an unchanged form shows the server's price. */
interface StoredPricing {
  category_id: string;
  purchase_cost: string;
  pricing_mode: PricingMode;
  custom_markup_percent: string;
  fixed_selling_price: string;
  /** The price the rule gave before the MRP cap (migration 048). */
  price: number | null;
  source: PricingSource | null;
  markup: number | null;
  /** The saved MRP as text ('' = none). */
  mrp: string;
}

/** The preview line's data; `legacy` = an API from before pricing sources (price only). */
type FormPreview = PricePreview & { legacy?: boolean };

/** The hint under "Custom markup %": what a blank field falls back to. */
export function inheritHint(inherited: InheritedMarkup, categoryName: string | null): string {
  const pct = `${formatPercent(inherited.markup)}%`;
  if (inherited.source === 'CATEGORY_MARKUP') {
    return `0 to 999.99. Leave blank to use the category markup (${inherited.categoryName} ${pct})`;
  }
  if (inherited.source === 'PARENT_CATEGORY_MARKUP') {
    return `0 to 999.99. Leave blank to use the parent category markup (${inherited.categoryName} ${pct}), as ${
      categoryName ?? 'the category'
    } has none`;
  }
  return categoryName
    ? `0 to 999.99. Leave blank to use the category markup, or the global markup (${pct}) as ${categoryName} has none`
    : `0 to 999.99. Leave blank to use the category markup, or the global markup (${pct}) if the category has none`;
}

/**
 * Add / edit a product against the existing backend product schema. The
 * selling price is set by Markup (cost + the product's markup, else the
 * category's, parent category's or global markup) or as a Fixed price
 * (migration 044; owner, 2026-10-13). The server computes and stores it;
 * this form previews it with the same rules (lib/pricing.ts).
 */
export function ProductForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // The saved pricing (and price, for the offer check while the preview
  // can't compute one).
  const [storedPricing, setStoredPricing] = useState<StoredPricing | null>(null);
  // Global default markup: the setting, else the product's copy, else 20.
  const [globalMarkup, setGlobalMarkup] = useState<number | null>(null);
  const [productGlobalMarkup, setProductGlobalMarkup] = useState<number | null>(null);
  const [storedOffer, setStoredOffer] = useState<StoredOffer>({ price: null, endsAt: null });
  // The image the saved product points at; replaced files are deleted only
  // after a successful save.
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const images = useImageCleanup([originalImage]);
  // Migration 045: the saved product-level stock, its variants and what a
  // variant's markup falls back to.
  const [storedStock, setStoredStock] = useState<StaffStock | null>(null);
  const [initialVariants, setInitialVariants] = useState<StaffVariant[] | undefined>(undefined);
  const [variantCount, setVariantCount] = useState(0);
  const [variantPricing, setVariantPricing] = useState<VariantPricingContext | null>(null);

  useEffect(() => {
    void categoriesApi
      .listAdmin()
      .then((rows) => {
        setCategories(rows);
        setForm((current) =>
          current.category_id || rows.length === 0
            ? current
            : { ...current, category_id: categoryOptions(rows)[0]!.category.id }
        );
      })
      .catch(() => setCategories([]));
    void settingsApi
      .getDefaultMarkup()
      .then((setting) => setGlobalMarkup(Number(setting.markup_percent)))
      .catch(() => setGlobalMarkup(null));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void productsApi
      .getAdmin(id)
      .then((product) => {
        if (cancelled) return;
        const mode: PricingMode = product.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP';
        const customMarkup =
          product.custom_markup_percent === null || product.custom_markup_percent === undefined
            ? ''
            : String(product.custom_markup_percent);
        const fixedPrice =
          product.fixed_selling_price === null || product.fixed_selling_price === undefined
            ? ''
            : String(product.fixed_selling_price);
        const mrpText = product.mrp === null || product.mrp === undefined ? '' : String(product.mrp);
        setForm({
          category_id: product.category_id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          pack_size: product.pack_size ?? '',
          barcode: product.barcode ?? '',
          description: product.description ?? '',
          image_url: product.image_url,
          purchase_cost: String(product.purchase_cost ?? ''),
          pricing_mode: mode,
          custom_markup_percent: customMarkup,
          fixed_selling_price: fixedPrice,
          mrp: mrpText,
          offer_price:
            product.offer_price === null || product.offer_price === undefined
              ? ''
              : String(product.offer_price),
          offer_ends_on: product.offer_ends_at ? colomboDate(product.offer_ends_at) : '',
          offer_mode: 'price',
          offer_off: '',
          show_offer_cut: product.show_offer_cut !== false,
          is_available: product.is_available,
          is_active: product.is_active,
          delivery_lead_days: String(product.delivery_lead_days ?? 0),
          stock_tracked: product.stock?.tracked ?? false,
          stock_count: product.stock?.tracked ? String(product.stock.on_hand) : '',
          stock_threshold: String(product.stock?.low_stock_threshold ?? DEFAULT_LOW_STOCK),
          stock_reason: '',
        });
        setStoredStock(product.stock ?? null);
        setInitialVariants(product.variants);
        setVariantCount(product.variants ? product.variants.length : product.has_variants ? product.variant_count ?? 1 : 0);
        setVariantPricing({
          productMarkupPercent: product.custom_markup_percent ?? null,
          categoryMarkupPercent: product.category_markup_percent ?? null,
          parentCategoryMarkupPercent: product.parent_category_markup_percent ?? null,
          globalMarkupPercent: product.global_markup_percent ?? null,
        });
        setStoredPricing({
          category_id: product.category_id,
          purchase_cost: String(product.purchase_cost ?? ''),
          pricing_mode: mode,
          custom_markup_percent: customMarkup,
          fixed_selling_price: fixedPrice,
          // Migration 048: the price before the MRP cap (the form applies the cap itself).
          price: product.computed_selling_price ?? product.calculated_selling_price ?? product.selling_price ?? null,
          source: product.pricing_source ?? null,
          markup: product.effective_markup_percent ?? null,
          mrp: mrpText,
        });
        setProductGlobalMarkup(product.global_markup_percent ?? null);
        setStoredOffer({ price: product.offer_price ?? null, endsAt: product.offer_ends_at ?? null });
        setOriginalImage(product.image_url ?? null);
      })
      .catch((err) =>
        setServerError(errorMessage(err, 'Could not load the product.'))
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const selectedCategory = categories.find((c) => c.id === form.category_id) ?? null;
  const inherited = useMemo(
    () => inheritedMarkup(form.category_id, categories, globalMarkup ?? productGlobalMarkup),
    [form.category_id, categories, globalMarkup, productGlobalMarkup]
  );

  /**
   * Preview only - the server computes the price on save. While the pricing
   * inputs are as saved, this is the server's own price and source.
   */
  const preview = useMemo<FormPreview | null>(() => {
    const cost = form.purchase_cost.trim() === '' ? NaN : Number(form.purchase_cost);
    const stored = storedPricing;
    const unchanged =
      stored !== null &&
      stored.price !== null &&
      stored.category_id === form.category_id &&
      stored.purchase_cost === form.purchase_cost.trim() &&
      stored.pricing_mode === form.pricing_mode &&
      (form.pricing_mode === 'FIXED'
        ? stored.fixed_selling_price === form.fixed_selling_price.trim()
        : stored.custom_markup_percent === form.custom_markup_percent.trim());
    if (unchanged && stored.price !== null) {
      const source = stored.source ?? (form.pricing_mode === 'FIXED' ? 'FIXED' : null);
      const parent = selectedCategory?.parent_id
        ? categories.find((c) => c.id === selectedCategory.parent_id) ?? null
        : null;
      return {
        mode: form.pricing_mode,
        source: source ?? 'GLOBAL_MARKUP',
        price: stored.price,
        markup: source ? stored.markup : null,
        categoryName:
          source === 'CATEGORY_MARKUP'
            ? selectedCategory?.name ?? null
            : source === 'PARENT_CATEGORY_MARKUP'
              ? parent?.name ?? null
              : null,
        lossPerUnit: Number.isFinite(cost) && stored.price < cost ? roundCents(cost - stored.price) : null,
        legacy: source === null,
      };
    }
    const markupText = form.custom_markup_percent.trim();
    const fixedText = form.fixed_selling_price.trim();
    return previewPrice({
      cost,
      mode: form.pricing_mode,
      fixedPrice: fixedText === '' ? null : Number(fixedText),
      customMarkup: markupText === '' ? null : Number(markupText),
      inherited,
    });
  }, [form, storedPricing, inherited, selectedCategory, categories]);

  /** The MRP as typed (migration 048): a number, null = none, undefined = not valid yet. */
  const mrpValue = useMemo(() => {
    const parsed = parseMrpInput(form.mrp);
    return 'value' in parsed ? parsed.value : undefined;
  }, [form.mrp]);

  /**
   * The selling price the offer must beat: the preview (else the saved
   * price), capped at the MRP (migration 048).
   */
  const sellingPrice = useMemo(() => {
    const price = preview?.price ?? storedPricing?.price ?? null;
    if (price === null || !Number.isFinite(price)) return null;
    return capAtMrp(Math.round(price * 100) / 100, mrpValue).price;
  }, [preview, storedPricing, mrpValue]);
  const mrpCapped = preview !== null && mrpValue !== undefined && capAtMrp(preview.price, mrpValue).capped;

  /** Markup | Fixed price. Switching to Fixed with no price starts from the current one. */
  function setPricingMode(mode: PricingMode) {
    if (mode === form.pricing_mode) return;
    if (mode === 'FIXED' && form.fixed_selling_price.trim() === '' && sellingPrice !== null && sellingPrice > 0) {
      setForm({ ...form, pricing_mode: 'FIXED', fixed_selling_price: moneyInput(sellingPrice) });
    } else {
      setForm({ ...form, pricing_mode: mode });
    }
  }

  /** What was typed in the active offer field; '' = no offer. */
  const offerText = (form.offer_mode === 'off' ? form.offer_off : form.offer_price).trim();
  /** The offer price to send: as typed, or selling price - amount off
   * (2 decimals); NaN while the amount cannot give one. */
  const offerValue = useMemo(() => {
    if (form.offer_mode === 'price') return Number(form.offer_price);
    const off = form.offer_off.trim();
    if (!MONEY_INPUT.test(off) || sellingPrice === null) return NaN;
    return round2(sellingPrice - Number(off));
  }, [form.offer_mode, form.offer_price, form.offer_off, sellingPrice]);

  const storedOfferDay = storedOffer.endsAt ? colomboDate(storedOffer.endsAt) : '';
  const offerChanged =
    (offerText === '' ? null : offerValue) !== (storedOffer.price === null ? null : Number(storedOffer.price)) ||
    form.offer_ends_on !== storedOfferDay;
  /** The stored offer's end has passed. */
  const storedOfferEnded =
    storedOffer.price !== null &&
    storedOffer.endsAt !== null &&
    Date.parse(storedOffer.endsAt) <= Date.now();

  /** "12% off - customers pay LKR 220 instead of LKR 250", while valid. */
  const offerSummary = useMemo(() => {
    const offer = offerValue;
    if (offerText === '' || !Number.isFinite(offer) || offer <= 0) return null;
    if (sellingPrice === null || offer >= sellingPrice) return null;
    // "LKR off" reads as the price customers end up paying (owner, 2026-10-10).
    if (form.offer_mode === 'off') return `Customers pay ${formatMoney(offer)} (was ${formatMoney(sellingPrice)})`;
    const percent = Math.round((1 - offer / sellingPrice) * 100);
    return `${percent}% off - customers pay ${formatMoney(offer)} instead of ${formatMoney(sellingPrice)}`;
  }, [offerText, offerValue, form.offer_mode, sellingPrice]);

  /** Switching "New price | LKR off" carries a valid offer across, so the
   * same offer shows both ways (250 selling: 220 <-> 30 off). */
  function setOfferMode(mode: OfferMode) {
    if (mode === form.offer_mode) return;
    const valid = offerText !== '' && Number.isFinite(offerValue) && offerValue > 0;
    if (mode === 'off') {
      const off = valid && sellingPrice !== null ? round2(sellingPrice - offerValue) : null;
      setForm({ ...form, offer_mode: 'off', offer_off: off !== null && off > 0 ? moneyInput(off) : '' });
    } else {
      setForm({ ...form, offer_mode: 'price', offer_price: valid ? moneyInput(offerValue) : '' });
    }
  }

  /** Stock is set per variant once the product has any (migration 045). */
  const hasVariants = variantCount > 0;
  const leadDays = Number(form.delivery_lead_days.trim());

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.category_id) next.category_id = 'Choose a category';
    if (form.name.trim().length < 2) next.name = 'Enter the product name';
    if (form.sku.trim().length < 3) next.sku = 'SKU must be at least 3 characters';
    if (form.unit.trim().length < 1) next.unit = 'Enter the unit, e.g. 1 L';
    const cost = Number(form.purchase_cost);
    if (!Number.isFinite(cost) || cost < 0) {
      next.purchase_cost = 'Enter a valid cost';
    } else if (cost > MAX_PURCHASE_COST) {
      next.purchase_cost = 'Purchase cost can be at most LKR 99,999,999.99';
    }
    if (form.pricing_mode === 'FIXED') {
      const fixed = form.fixed_selling_price.trim();
      if (fixed === '') {
        next.fixed_selling_price = 'Enter the selling price for a fixed-price product';
      } else if (!MONEY_INPUT.test(fixed) || Number(fixed) <= 0) {
        next.fixed_selling_price = 'Enter a price above 0 with at most 2 decimals';
      } else if (Number(fixed) > MAX_SELLING_PRICE) {
        next.fixed_selling_price = 'Selling price can be at most LKR 99,999,999.99';
      }
    } else if (form.custom_markup_percent.trim() !== '') {
      const markup = Number(form.custom_markup_percent);
      if (!Number.isFinite(markup) || markup < 0 || markup > MAX_MARKUP_PERCENT) {
        next.custom_markup_percent = 'Markup must be between 0 and 999.99';
      }
    }
    // MRP (migration 048): optional, above 0.
    const mrp = parseMrpInput(form.mrp);
    if ('error' in mrp) next.mrp = mrp.error;
    // Offer (owner, 2026-10-09). An ended offer left untouched is not
    // re-checked: it is not sent, and the backend keeps it as stored.
    if (offerText !== '' && (offerChanged || !storedOfferEnded)) {
      const offer = offerValue;
      if (form.offer_mode === 'off' && (!MONEY_INPUT.test(offerText) || Number(offerText) <= 0)) {
        next.offer_price = 'Enter an amount above 0 with at most 2 decimals';
      } else if (form.offer_mode === 'off' && sellingPrice === null) {
        next.offer_price = 'Enter a valid purchase cost first, so the selling price is known.';
      } else if (!Number.isFinite(offer) || offer <= 0 || (form.offer_mode === 'price' && !MONEY_INPUT.test(offerText))) {
        next.offer_price = 'Enter a price above 0 with at most 2 decimals';
      } else if (sellingPrice !== null && offer >= sellingPrice) {
        next.offer_price = mrpCapped
          ? `The offer price must be lower than the selling price (${formatMoney(sellingPrice)}, capped at the MRP).`
          : `The offer price must be lower than the selling price (${formatMoney(sellingPrice)}).`;
      }
      if (form.offer_ends_on && form.offer_ends_on !== storedOfferDay && form.offer_ends_on < colomboDate()) {
        next.offer_ends_at = 'Pick today or a later day';
      } else if (storedOfferEnded && form.offer_ends_on && form.offer_ends_on === storedOfferDay) {
        next.offer_ends_at = 'This offer has ended. Pick a new end day or clear it.';
      }
    }
    // Delivery lead time and the product's own stock (migration 045).
    const lead = parseWhole(form.delivery_lead_days, { max: MAX_LEAD_DAYS, what: 'Delivery lead time' });
    if ('error' in lead) next.delivery_lead_days = `${lead.error} (0 = same day)`;
    if (!hasVariants && form.stock_tracked) {
      const count = parseWhole(form.stock_count, { what: 'Stock count' });
      if ('error' in count) next.stock_count = count.error;
      const threshold = parseWhole(form.stock_threshold, { what: 'Low-stock level' });
      if ('error' in threshold) next.stock_threshold = threshold.error;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /**
   * PUT /admin/inventory/:id/stock when the Stock section changed (a new
   * product: when tracking is on). stock_count goes only when it changed.
   * Null = nothing to send.
   */
  function stockRequest(isNew: boolean): SetStockInput | null {
    if (hasVariants) return null;
    const count = parseWhole(form.stock_count, { what: 'Stock count' });
    const threshold = parseWhole(form.stock_threshold, { what: 'Low-stock level' });
    const countValue = 'value' in count ? count.value : null;
    const thresholdValue = 'value' in threshold ? threshold.value : null;
    const reason = form.stock_reason.trim();
    if (isNew) {
      if (!form.stock_tracked) return null;
      const body: SetStockInput = { tracked: true };
      if (countValue !== null) body.stock_count = countValue;
      if (thresholdValue !== null) body.low_stock_threshold = thresholdValue;
      if (reason) body.reason = reason;
      return body;
    }
    const wasTracked = storedStock?.tracked ?? false;
    const body: SetStockInput = { tracked: form.stock_tracked };
    let changed = form.stock_tracked !== wasTracked;
    if (form.stock_tracked && countValue !== null && countValue !== (wasTracked ? storedStock!.on_hand : null)) {
      body.stock_count = countValue;
      changed = true;
    }
    if (form.stock_tracked && thresholdValue !== null && thresholdValue !== (storedStock?.low_stock_threshold ?? DEFAULT_LOW_STOCK)) {
      body.low_stock_threshold = thresholdValue;
      changed = true;
    }
    if (!changed) return null;
    if (reason) body.reason = reason;
    return body;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    const payload: Record<string, unknown> = {
      category_id: form.category_id,
      name: form.name.trim(),
      sku: form.sku.trim(),
      unit: form.unit.trim(),
      pack_size: form.pack_size.trim() || null,
      barcode: form.barcode.trim() || null,
      description: form.description.trim() || null,
      image_url: form.image_url,
      purchase_cost: Number(form.purchase_cost),
      is_available: form.is_available,
      is_active: form.is_active,
      delivery_lead_days: Number(form.delivery_lead_days.trim() || '0'),
      show_offer_cut: form.show_offer_cut,
    };
    // Markup sends the custom markup (null = inherit) and leaves the stored
    // fixed price alone; Fixed price sends the price and leaves the stored
    // custom markup alone (migration 044).
    if (form.pricing_mode === 'FIXED') {
      payload.pricing_mode = 'FIXED';
      payload.fixed_selling_price = Number(form.fixed_selling_price.trim());
    } else {
      payload.pricing_mode = 'MARKUP';
      payload.custom_markup_percent =
        form.custom_markup_percent.trim() === '' ? null : Number(form.custom_markup_percent);
    }
    // MRP (migration 048): sent only when it changed (blank clears it).
    if (form.mrp.trim() !== (storedPricing?.mrp ?? '')) payload.mrp = form.mrp.trim() === '' ? null : Number(form.mrp.trim());
    // Offer fields go only when they changed (owner, 2026-10-09): a cleared
    // price removes the offer (the backend clears its end too), and an
    // unchanged end is resent exactly as stored.
    // "LKR off" sends selling price - amount (owner, 2026-10-10).
    if (offerChanged) {
      if (offerText === '') {
        if (storedOffer.price !== null) payload.offer_price = null;
      } else {
        payload.offer_price = offerValue;
        payload.offer_ends_at =
          form.offer_ends_on === storedOfferDay
            ? storedOffer.endsAt
            : form.offer_ends_on
              ? offerEndOf(form.offer_ends_on)
              : null;
      }
    }

    setSaving(true);
    try {
      const stock = stockRequest(!isEditing);
      const saved = isEditing && id ? await productsApi.update(id, payload) : await productsApi.create(payload);
      toast.success(isEditing ? 'Product updated.' : 'Product created.');
      // A fixed price under cost saves, with the server's warning.
      if (saved?.price_warning?.message) toast.error(`Saved with a warning: ${saved.price_warning.message}`);
      // Saved: the image it no longer uses (removed or replaced) can go now.
      await images.afterSave([form.image_url]);
      // The Stock section, right after the product (migration 045).
      const productId = saved?.id ?? id;
      if (stock && productId) {
        try {
          const result = await inventoryApi.setStock(productId, stock);
          setStoredStock(result.stock);
        } catch (err) {
          const message = `The product is saved, but the stock is not: ${errorMessage(err, 'Could not set the stock.')}`;
          toast.error(message);
          if (isEditing) {
            setServerError(message);
          } else {
            navigate(`/products/${productId}`);
          }
          return;
        }
      }
      navigate('/products');
    } catch (err) {
      // The offer refusals carry their own codes; show them by their field.
      if (err instanceof ApiError && err.code === 'FIXED_PRICE_REQUIRED') {
        setErrors({ fixed_selling_price: err.message });
        setServerError(null);
        return;
      }
      if (err instanceof ApiError && (err.code === 'OFFER_PRICE_NOT_LOWER' || err.code === 'OFFER_END_IN_PAST')) {
        setErrors({ [err.code === 'OFFER_PRICE_NOT_LOWER' ? 'offer_price' : 'offer_ends_at']: err.message });
        setServerError(null);
        return;
      }
      const { inline, message } = splitServerErrors(err, INLINE_FIELDS, 'Could not save the product.');
      setErrors(inline);
      setServerError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading product" />;

  return (
    <>
      <PageHeader
        title={isEditing ? 'Edit product' : 'Add product'}
        description="Customers never see purchase cost or markup - only the calculated selling price."
      />

      <form className="form" onSubmit={handleSubmit}>
        <section className="form__section">
          <h2 className="form__section-title">Details</h2>
          <Field label="Product name" error={errors.name}>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Category" error={errors.category_id}>
            <select
              className="input"
              value={form.category_id}
              onChange={(event) => setForm({ ...form, category_id: event.target.value })}
            >
              <option value="">Select a category</option>
              {/* Each category followed by its sub-categories ("Rice & Flour › Rice"). */}
              {categoryOptions(categories).map(({ category, label }) => (
                <option key={category.id} value={category.id}>
                  {label}
                  {category.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </Field>
          <div className="form__row">
            <Field label="SKU" error={errors.sku}>
              <input
                className="input"
                value={form.sku}
                onChange={(event) => setForm({ ...form, sku: event.target.value })}
              />
            </Field>
            <Field label="Barcode" hint="Optional">
              <input
                className="input"
                value={form.barcode}
                onChange={(event) => setForm({ ...form, barcode: event.target.value })}
              />
            </Field>
          </div>
          <div className="form__row">
            <Field label="Unit" hint="e.g. 1 L, 500 g" error={errors.unit}>
              <input
                className="input"
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
              />
            </Field>
            <Field label="Pack size" hint="Optional, e.g. Tetra Pack">
              <input
                className="input"
                value={form.pack_size}
                onChange={(event) => setForm({ ...form, pack_size: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Description" hint="Shown on the product page when present">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
        </section>

        <section className="form__section">
          <h2 className="form__section-title">Image</h2>
          <ImageUploader
            value={form.image_url}
            folder="products"
            label="Product image"
            onChange={(url) => {
              images.track(url);
              setForm((current) => ({ ...current, image_url: url }));
            }}
          />
        </section>

        <section className="form__section" aria-label="Pricing">
          <h2 className="form__section-title">Pricing</h2>
          <Field label="Purchase cost (LKR)" error={errors.purchase_cost}>
            <input
              className="input"
              inputMode="decimal"
              value={form.purchase_cost}
              onChange={(event) =>
                setForm({ ...form, purchase_cost: event.target.value })
              }
            />
          </Field>
          <div className="field">
            <span className="field__label" id="pricing-mode-label">Selling price</span>
            <div className="segmented" role="group" aria-labelledby="pricing-mode-label">
              {PRICING_MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === form.pricing_mode ? 'segmented__item is-selected' : 'segmented__item'}
                  aria-pressed={option.value === form.pricing_mode}
                  onClick={() => setPricingMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {form.pricing_mode === 'FIXED' ? (
            <Field
              label="Selling price (LKR)"
              hint="Customers pay exactly this. Cost and markup changes do not move it"
              error={errors.fixed_selling_price}
            >
              <input
                className="input"
                inputMode="decimal"
                value={form.fixed_selling_price}
                onChange={(event) => setForm({ ...form, fixed_selling_price: event.target.value })}
              />
            </Field>
          ) : (
            <Field
              label="Custom markup %"
              hint={inheritHint(inherited, selectedCategory?.name ?? null)}
              error={errors.custom_markup_percent}
            >
              <input
                className="input"
                inputMode="decimal"
                value={form.custom_markup_percent}
                onChange={(event) =>
                  setForm({ ...form, custom_markup_percent: event.target.value })
                }
              />
            </Field>
          )}
          <Field
            label="MRP (LKR)"
            hint="Optional. The Maximum Retail Price on the pack. If the selling price is higher, customers pay the MRP"
            error={errors.mrp}
          >
            <input
              className="input"
              inputMode="decimal"
              value={form.mrp}
              onChange={(event) => setForm({ ...form, mrp: event.target.value })}
            />
          </Field>
          <PricePreviewNote preview={preview} mode={form.pricing_mode} mrp={mrpValue ?? null} />
        </section>

        <section className="form__section" aria-label="Offer">
          <h2 className="form__section-title">Offer</h2>
          <div className="segmented" role="group" aria-label="Offer as">
            {OFFER_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === form.offer_mode ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={option.value === form.offer_mode}
                onClick={() => setOfferMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="form__row">
            {form.offer_mode === 'off' ? (
              <Field
                label="Amount off (LKR)"
                hint="Optional. Taken off the selling price"
                error={errors.offer_price}
              >
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.offer_off}
                  onChange={(event) => setForm({ ...form, offer_off: event.target.value })}
                />
              </Field>
            ) : (
              <Field
                label="Offer price (LKR)"
                hint="Optional. Customers pay this instead of the selling price"
                error={errors.offer_price}
              >
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.offer_price}
                  onChange={(event) => setForm({ ...form, offer_price: event.target.value })}
                />
              </Field>
            )}
            <Field
              label="Offer ends"
              hint="Optional. The offer runs to the end of this day"
              error={errors.offer_ends_at}
            >
              <input
                className="input"
                type="date"
                value={form.offer_ends_on}
                min={colomboDate()}
                disabled={offerText === ''}
                onChange={(event) => setForm({ ...form, offer_ends_on: event.target.value })}
              />
            </Field>
          </div>
          {storedOfferEnded && !offerChanged && storedOffer.endsAt ? (
            <p className="form__note" role="status">
              Offer ended on {formatDay(storedOffer.endsAt)}. Customers pay the selling price.
            </p>
          ) : offerSummary ? (
            <p className="form__note" role="status">
              {offerSummary}
              {form.offer_ends_on ? `, until ${formatDay(offerEndOf(form.offer_ends_on))}` : ''}.
            </p>
          ) : offerText !== '' && sellingPrice === null ? (
            <p className="form__note">The offer price must be lower than the selling price calculated on save.</p>
          ) : null}
          {offerText === '' && storedOffer.price !== null ? (
            <p className="form__note">The offer is removed when you save.</p>
          ) : null}
          {offerText !== '' ? (
            <div>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setForm({ ...form, offer_price: '', offer_off: '', offer_ends_on: '' })}
              >
                Remove offer
              </button>
            </div>
          ) : null}
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.show_offer_cut}
              onChange={(event) => setForm({ ...form, show_offer_cut: event.target.checked })}
            />
            <span>
              <strong>Show offer price cut</strong>
              <em>Customers see the old price struck through and how much they save (offer or MRP).</em>
            </span>
          </label>
        </section>

        <section className="form__section" aria-label="Delivery">
          <h2 className="form__section-title">Delivery</h2>
          <Field
            label="Delivery lead time (days)"
            hint="Whole days, 0 to 30. 0 = same day. Customers can pick delivery from today + N days"
            error={errors.delivery_lead_days}
          >
            <input
              className="input"
              inputMode="numeric"
              value={form.delivery_lead_days}
              onChange={(event) => setForm({ ...form, delivery_lead_days: event.target.value })}
            />
          </Field>
          {Number.isInteger(leadDays) && leadDays > 0 && leadDays <= MAX_LEAD_DAYS ? (
            <p className="form__note" role="status">
              Customers can pick delivery from today + {leadDays} {leadDays === 1 ? 'day' : 'days'}. As soon as possible is not
              offered for a basket with this product.
            </p>
          ) : null}
        </section>

        <section className="form__section" aria-label="Stock">
          <h2 className="form__section-title">Stock</h2>
          {hasVariants ? (
            <p className="form__note">This product has variants: stock is set per variant, in the Variants section.</p>
          ) : (
            <>
              <p className="form__note">
                Customers never see the count. They can order until the sellable stock reaches 0, then the product shows as sold
                out. Low stock shows on the Purchase list.
              </p>
              <Switch
                checked={form.stock_tracked}
                onChange={(on) => setForm({ ...form, stock_tracked: on })}
                label="Track stock"
              >
                Track stock
              </Switch>
              {form.stock_tracked ? (
                <>
                  <div className="form__row">
                    <Field
                      label="Stock count"
                      hint={isEditing && storedStock?.tracked ? 'On hand now. Change it to set a new count' : 'Whole number, optional'}
                      error={errors.stock_count}
                    >
                      <input
                        className="input"
                        inputMode="numeric"
                        value={form.stock_count}
                        onChange={(event) => setForm({ ...form, stock_count: event.target.value })}
                      />
                    </Field>
                    <Field label="Low-stock level" hint="Shows as running low at or below this" error={errors.stock_threshold}>
                      <input
                        className="input"
                        inputMode="numeric"
                        value={form.stock_threshold}
                        onChange={(event) => setForm({ ...form, stock_threshold: event.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Reason" hint="Optional, kept with a count change, e.g. Shelf count">
                    <input
                      className="input"
                      value={form.stock_reason}
                      onChange={(event) => setForm({ ...form, stock_reason: event.target.value })}
                    />
                  </Field>
                </>
              ) : (
                <p className="form__note">Not tracked: never limited, sourced on order.</p>
              )}
              {storedStock?.tracked ? <StockFigures stock={storedStock} /> : null}
            </>
          )}
        </section>

        {isEditing && id ? (
          variantPricing ? (
            <ProductVariants
              productId={id}
              initial={initialVariants}
              pricing={{ ...variantPricing, globalMarkupPercent: variantPricing.globalMarkupPercent ?? globalMarkup }}
              onChange={(list) => setVariantCount(list.length)}
            />
          ) : null
        ) : (
          <section className="form__section" aria-label="Variants">
            <h2 className="form__section-title">Variants</h2>
            <p className="form__note">
              Save the product first to add variants (sizes or packs with their own price and stock, e.g. 50 g, 100 g).
            </p>
          </section>
        )}

        <section className="form__section">
          <h2 className="form__section-title">Availability</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
            />
            <span>
              <strong>Active</strong>
              <em>Inactive products disappear from the customer catalog.</em>
            </span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.is_available}
              onChange={(event) =>
                setForm({ ...form, is_available: event.target.checked })
              }
            />
            <span>
              <strong>Available</strong>
              <em>Unavailable products are shown but cannot be added to a cart.</em>
            </span>
          </label>
        </section>

        {serverError ? <p className="field__error">{serverError}</p> : null}

        <div className="form__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => navigate('/products')}
          >
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : isEditing ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </form>
    </>
  );
}

/** The live selling price under the pricing fields (the server recalculates on save). */
function PricePreviewNote({ preview, mode, mrp }: { preview: FormPreview | null; mode: PricingMode; mrp: number | null }) {
  // Migration 048: a price above the MRP is capped at it.
  if (preview && mrp !== null && capAtMrp(preview.price, mrp).capped) {
    return <MrpCappedNote computed={preview.price} mrp={mrp} mode={preview.mode} />;
  }
  if (!preview) {
    return (
      <p className="form__note" role="status">
        {mode === 'FIXED'
          ? 'Enter the purchase cost and the selling price to see the margin.'
          : 'Enter the purchase cost to see the selling price.'}
      </p>
    );
  }
  if (preview.legacy) {
    return (
      <p className="form__note" role="status">
        Selling price {formatLkr(preview.price)}
      </p>
    );
  }
  if (preview.mode === 'FIXED') {
    return (
      <>
        <p className="form__note" role="status">
          Selling price {formatLkr(preview.price)}
          {preview.markup === null
            ? ''
            : preview.markup < 0
              ? ` (${formatPercent(-preview.markup)}% below cost)`
              : ` (${formatPercent(preview.markup)}% over cost)`}
        </p>
        {preview.lossPerUnit !== null ? (
          <p className="field__error" role="alert">
            Below purchase cost — you lose {formatLkr(preview.lossPerUnit)} per unit. You can still save it.
          </p>
        ) : null}
        {mrp !== null ? <MrpBelowNote price={preview.price} mrp={mrp} /> : null}
      </>
    );
  }
  return (
    <>
      <p className="form__note" role="status">
        Selling price {formatLkr(preview.price)} ({markupSourceText(preview.source, preview.markup, preview.categoryName)})
      </p>
      {mrp !== null ? <MrpBelowNote price={preview.price} mrp={mrp} /> : null}
    </>
  );
}

/** Migration 048: the selling price is the MRP; says what the markup / fixed price would give. */
export function MrpCappedNote({ computed, mrp, mode }: { computed: number; mrp: number; mode: PricingMode }) {
  return (
    <>
      <p className="form__note" role="status">
        Selling price {formatLkr(mrp)} (the MRP)
      </p>
      <p className="form__note mrp-capped" role="status">
        {mrpCappedNote(mode, computed)}
      </p>
    </>
  );
}

/** Migration 048: the price is under the MRP, so the app shows the MRP struck through. */
function MrpBelowNote({ price, mrp }: { price: number; mrp: number }) {
  if (!(price < mrp)) return null;
  return (
    <p className="form__note" role="status">
      Below the MRP ({formatLkr(mrp)}): customers see the MRP struck through next to the price.
    </p>
  );
}
