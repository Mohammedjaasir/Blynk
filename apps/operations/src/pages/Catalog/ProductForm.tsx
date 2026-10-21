import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteImagesQuietly } from '../../api/client';
import { catalog, inventory as inventoryApi, settings } from '../../api/resources';
import type { AdminProduct, Category, PricingMode, SetStockInput, StaffStock, StaffVariant } from '../../api/types';
import { CENTRE_FOCAL, ImageUploader, type FocalPoint } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { ProductAdLinks } from '../../components/ProductAdLinks';
import { Field, Spinner } from '../../components/ui';
import {
  catalogErrorMessage,
  categoryOptions,
  colomboDay,
  colomboTodayDay,
  formatColomboDate,
  offerEndForDay,
  parseLeadDays,
  parseOfferAmountOff,
  parseOfferPrice,
  parseStockNumber,
  percentOff,
  serverFieldError,
} from '../../lib/catalog';
import { staffStockBadge } from '../../lib/inventory';
import { ProductVariants } from './ProductVariants';
import { replacedImages } from '../../lib/image';
import {
  COST_REQUIRED_FOR_MARKUP,
  FALLBACK_DEFAULT_MARKUP_PERCENT,
  belowCostText,
  capAtMrp,
  costInput,
  parseCostInput,
  inheritedMarkup,
  marginPercent,
  markupPrice,
  markupSourceText,
  mrpCappedNote,
  parseMarkupPercent,
  parseMrpInput,
  parseSellingPrice,
  percentText,
  resolveMarkup,
  type ResolvedMarkup,
} from '../../lib/pricing';

interface FormState {
  category_id: string;
  name: string;
  sku: string;
  unit: string;
  pack_size: string;
  barcode: string;
  description: string;
  image_url: string | null;
  /**
   * Where the tile's crop anchors on the photo (backend migration 009).
   * The customer grid draws the image with `BoxFit.cover`, so anything that
   * does not fit the square is cropped; this says which point must survive.
   */
  image_focal: FocalPoint;
  purchase_cost: string;
  /** Selling price mode (migration 044; owner, 2026-10-13). */
  pricing_mode: PricingMode;
  /** MARKUP mode: the product's own markup; '' = inherit. */
  custom_markup_percent: string;
  /** FIXED mode: the exact selling price. */
  fixed_selling_price: string;
  /** MRP (migration 048) as typed; '' = none. The selling price is capped at it. */
  mrp: string;
  is_available: boolean;
  is_active: boolean;
  /** Show the struck "was" price and the saving in the app (migration 050; owner, 2026-10-18). */
  show_offer_cut: boolean;
  /** Offer price in LKR as typed; '' = no offer (owner, 2026-10-09). */
  offer_price: string;
  /** The offer's last day (Colombo), YYYY-MM-DD; '' = no end date. */
  offer_end_day: string;
  /**
   * How the offer is typed (owner, 2026-10-10): 'price' = the new price,
   * 'off' = LKR taken off the selling price. Only the price is ever sent.
   */
  offer_mode: OfferMode;
  /** LKR off as typed, used when offer_mode is 'off'; '' = no offer. */
  offer_off: string;
  /** Migration 045: whole days before it can be delivered; '' = 0 (same day). */
  delivery_lead_days: string;
  /** Migration 045: the product's own stock (PUT /admin/inventory/:id/stock). */
  track_stock: boolean;
  stock_count: string;
  low_stock_threshold: string;
  stock_reason: string;
}

/** An untracked product's stock, for a new product or an API from before 045. */
const NO_STOCK: StaffStock = {
  inventory_id: null,
  tracked: false,
  on_hand: 0,
  reserved: 0,
  in_open_orders: 0,
  sellable: null,
  low_stock_threshold: 5,
  is_low_stock: false,
  is_out_of_stock: false,
};

type OfferMode = 'price' | 'off';
const OFFER_MODES: Array<{ value: OfferMode; label: string }> = [
  { value: 'price', label: 'New price' },
  { value: 'off', label: 'LKR off' },
];

/** The offer as the API last returned it - what "changed" is measured against. */
interface SavedOffer {
  price: string;
  endDay: string;
  endsAt: string | null;
  active: boolean;
}

const PRICING_MODES: Array<{ value: PricingMode; label: string }> = [
  { value: 'MARKUP', label: 'Markup' },
  { value: 'FIXED', label: 'Fixed price' },
];

const NO_OFFER: SavedOffer = { price: '', endDay: '', endsAt: null, active: false };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const EMPTY: FormState = {
  category_id: '',
  name: '',
  sku: '',
  unit: '',
  pack_size: '',
  barcode: '',
  description: '',
  image_url: null,
  // The centre, which is precisely what a `cover` crop already did.
  image_focal: CENTRE_FOCAL,
  purchase_cost: '',
  // New products start on Fixed price (owner, 2026-10-21): type the selling
  // price, add the cost later.
  pricing_mode: 'FIXED',
  custom_markup_percent: '',
  fixed_selling_price: '',
  mrp: '',
  is_available: true,
  is_active: true,
  show_offer_cut: true,
  offer_price: '',
  offer_end_day: '',
  offer_mode: 'price',
  offer_off: '',
  delivery_lead_days: '0',
  track_stock: false,
  stock_count: '',
  low_stock_threshold: '5',
  stock_reason: '',
};

/**
 * Add / edit a product (task F5) - ported from
 * `apps/admin/src/pages/ProductForm.tsx` (a fresh implementation, not an
 * import - common.md rule 2). No field here is invented: purchase cost and
 * markup are the backend's own pricing inputs, and the selling price stays
 * a backend calculation - this form only previews it, and always re-saves
 * to let the backend recompute the real value (common.md rule 8 - no
 * client-side price authority).
 */
/**
 * Migration 048: when the selling price is the MRP, an offer refused for not
 * being lower says so ("..., capped at the MRP").
 */
function withMrpReason<T extends { value: number } | { error: string }>(parsed: T | null, capped: boolean): T | null {
  if (!parsed || !capped || !('error' in parsed) || !parsed.error.startsWith('The offer price must be lower')) return parsed;
  return { ...parsed, error: parsed.error.replace(/\)\.$/, ', capped at the MRP).') };
}

export function ProductForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  /** The global default markup (GET /admin/settings/default-markup); null = not loaded. */
  const [globalMarkup, setGlobalMarkup] = useState<number | null>(null);
  /** The saved product's own copy of the global markup, the fallback when the setting cannot be read. */
  const [productGlobalMarkup, setProductGlobalMarkup] = useState<number | null>(null);
  /** The image the saved product points at - deleted only once a save replaces it. */
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  /** The saved product's own selling price, for when no preview can be worked out. */
  const [savedSellingPrice, setSavedSellingPrice] = useState<number | null>(null);
  /** The saved MRP as text ('' = none) - the MRP is sent only when it changed. */
  const [savedMrp, setSavedMrp] = useState('');
  const [savedOffer, setSavedOffer] = useState<SavedOffer>(NO_OFFER);
  /** The saved product (edit only) - its markups price the variants. */
  const [savedProduct, setSavedProduct] = useState<AdminProduct | null>(null);
  const [savedStock, setSavedStock] = useState<StaffStock>(NO_STOCK);
  const [variants, setVariants] = useState<StaffVariant[]>([]);

  useEffect(() => {
    void catalog.categories
      .list()
      .then((rows) => {
        setCategories(rows);
        const first = categoryOptions(rows)[0];
        setForm((current) => (current.category_id || !first ? current : { ...current, category_id: first.id }));
      })
      .catch(() => setCategories([]));
    // Preview only; when this cannot be read the product's own copy (or 20%) stands in.
    void settings.defaultMarkup
      .get()
      .then((s) => setGlobalMarkup(Number(s.markup_percent)))
      .catch(() => setGlobalMarkup(null));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void catalog.products
      .getAdmin(id)
      .then((product) => {
        if (cancelled) return;
        setSavedImageUrl(product.image_url);
        setSavedProduct(product);
        setVariants(product.variants ?? []);
        const stock = product.stock ?? NO_STOCK;
        setSavedStock(stock);
        const offer: SavedOffer = {
          price: product.offer_price === null || product.offer_price === undefined ? '' : String(product.offer_price),
          // Shown back as the day it ends on in Colombo, whatever time it was stored at.
          endDay: product.offer_ends_at ? colomboDay(product.offer_ends_at) : '',
          endsAt: product.offer_ends_at ?? null,
          active: product.offer_active === true,
        };
        setSavedOffer(offer);
        // Migration 048: the price before the MRP cap (the form applies the cap itself).
        const storedPrice = product.computed_selling_price ?? product.calculated_selling_price ?? product.selling_price;
        setSavedSellingPrice(storedPrice === undefined || storedPrice === null ? null : Number(storedPrice));
        const mrpText = product.mrp === null || product.mrp === undefined ? '' : String(product.mrp);
        setSavedMrp(mrpText);
        setForm({
          category_id: product.category_id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          pack_size: product.pack_size ?? '',
          barcode: product.barcode ?? '',
          description: product.description ?? '',
          image_url: product.image_url,
          // An API response from before 009 carries no focal point at all;
          // the centre is both the default and the behaviour it already had.
          image_focal: {
            x: product.image_focal_x ?? 50,
            y: product.image_focal_y ?? 50,
          },
          purchase_cost: costInput(product.purchase_cost),
          pricing_mode: product.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP',
          custom_markup_percent:
            product.custom_markup_percent === null || product.custom_markup_percent === undefined
              ? ''
              : String(product.custom_markup_percent),
          fixed_selling_price:
            product.fixed_selling_price === null || product.fixed_selling_price === undefined
              ? ''
              : String(product.fixed_selling_price),
          mrp: mrpText,
          is_available: product.is_available,
          is_active: product.is_active,
          show_offer_cut: product.show_offer_cut !== false,
          // A stored offer opens as its price; "LKR off" shows the same
          // offer as an amount off the current selling price.
          offer_price: offer.price,
          offer_end_day: offer.endDay,
          offer_mode: 'price',
          offer_off: '',
          delivery_lead_days: String(product.delivery_lead_days ?? 0),
          track_stock: stock.tracked,
          stock_count: stock.tracked ? String(stock.on_hand) : '',
          low_stock_threshold: String(stock.low_stock_threshold ?? 5),
          stock_reason: '',
        });
        setProductGlobalMarkup(
          product.global_markup_percent === null || product.global_markup_percent === undefined
            ? null
            : Number(product.global_markup_percent)
        );
      })
      .catch((err) => setServerError(catalogErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const globalPercent = globalMarkup ?? productGlobalMarkup ?? FALLBACK_DEFAULT_MARKUP_PERCENT;
  /** What a blank "Custom markup %" means for the chosen category. */
  const inherited = useMemo(
    () => inheritedMarkup(form.category_id, categories, globalPercent),
    [form.category_id, categories, globalPercent]
  );
  const selectedCategory = categories.find((c) => c.id === form.category_id) ?? null;
  /** Each category followed by its sub-categories ("Category › Sub-category"), in customer order. */
  const pickerOptions = useMemo(() => categoryOptions(categories), [categories]);

  /** The cost price as typed (empty = 0, not set yet), or null when it is not a valid amount. */
  const cost = useMemo(() => parseCostInput(form.purchase_cost), [form.purchase_cost]);

  /**
   * Preview only - the same rule and rounding as the server (lib/pricing.ts),
   * which recomputes it on save; its value is the one customers see.
   * MARKUP: cost x (1 + markup), the markup being the product's own, else the
   * category's, parent's or global one. FIXED: the typed price itself.
   */
  const preview = useMemo((): { price: number; markup: ResolvedMarkup | null } | null => {
    if (form.pricing_mode === 'FIXED') {
      const parsed = parseSellingPrice(form.fixed_selling_price);
      if ('error' in parsed) return null;
      return { price: parsed.value, markup: null };
    }
    // No cost price yet: a markup price cannot be worked out.
    if (cost === null || !(cost > 0)) return null;
    const custom = parseMarkupPercent(form.custom_markup_percent);
    if ('error' in custom) return null;
    const markup = resolveMarkup(custom.value, inherited);
    return { price: markupPrice(cost, markup.percent), markup };
  }, [form.pricing_mode, form.fixed_selling_price, form.custom_markup_percent, cost, inherited]);
  const previewPrice = preview?.price ?? null;

  /** The MRP as typed (migration 048): a number, null = none, undefined = not valid yet. */
  const mrpValue = useMemo(() => {
    const parsed = parseMrpInput(form.mrp);
    return 'value' in parsed ? parsed.value : undefined;
  }, [form.mrp]);
  /** The preview capped at the MRP - what customers actually pay before offers. */
  const previewCapped = previewPrice !== null ? capAtMrp(previewPrice, mrpValue) : null;
  const effectivePrice = previewCapped?.price ?? null;
  const margin = effectivePrice !== null && cost !== null ? marginPercent(cost, effectivePrice) : null;
  const belowCost = effectivePrice !== null && cost !== null ? belowCostText(cost, effectivePrice) : null;

  /** The selling price the offer is measured against: the preview above, else
   * the saved product's own price - capped at the MRP (migration 048). */
  const uncappedForOffer = previewPrice ?? savedSellingPrice;
  const offerCap = uncappedForOffer !== null ? capAtMrp(uncappedForOffer, mrpValue) : null;
  const sellingForOffer = offerCap?.price ?? null;

  /** What the operator typed in the active offer field; '' = no offer. */
  const offerText = (form.offer_mode === 'off' ? form.offer_off : form.offer_price).trim();
  const offerParsed = withMrpReason(
    offerText === ''
      ? null
      : form.offer_mode === 'off'
        ? parseOfferAmountOff(form.offer_off, sellingForOffer)
        : parseOfferPrice(form.offer_price, sellingForOffer),
    offerCap?.capped === true
  );
  const offerPriceChanged =
    form.offer_mode === 'off'
      ? offerText === ''
        ? savedOffer.price !== ''
        : !(offerParsed && 'value' in offerParsed && savedOffer.price !== '' && offerParsed.value === Number(savedOffer.price))
      : form.offer_price.trim() !== savedOffer.price;
  const offerEndChanged = form.offer_end_day !== savedOffer.endDay;
  /** The stored offer's end has passed and the operator has not picked a new one. */
  const offerEnded =
    savedOffer.price !== '' &&
    savedOffer.endsAt !== null &&
    !offerEndChanged &&
    new Date(savedOffer.endsAt).getTime() <= Date.now();

  /**
   * Switching "New price | LKR off" carries a valid offer across, so the
   * same offer shows both ways (250 selling, 200 offer <-> 50 off).
   */
  function setOfferMode(mode: OfferMode) {
    if (mode === form.offer_mode) return;
    const carried = offerParsed && 'value' in offerParsed ? offerParsed.value : null;
    if (mode === 'off') {
      const off = carried !== null && sellingForOffer !== null ? round2(sellingForOffer - carried) : null;
      setForm({ ...form, offer_mode: 'off', offer_off: off !== null && off > 0 ? off.toFixed(2).replace(/\.00$/, '') : '' });
    } else {
      setForm({
        ...form,
        offer_mode: 'price',
        offer_price: carried !== null ? (form.offer_mode === 'off' ? carried.toFixed(2).replace(/\.00$/, '') : form.offer_price) : '',
      });
    }
  }

  /** A product with variants keeps its stock per variant (migration 045). */
  const hasVariants = variants.length > 0;

  /**
   * The Stock section's PUT body, or null when nothing there changed (so an
   * unrelated edit never touches the ledger). The count goes only when it
   * changed; a NEW product sends it only when tracking is on.
   */
  function stockChange(): SetStockInput | null {
    if (hasVariants) return null;
    const count = parseStockNumber(form.stock_count, 'Stock count');
    const threshold = parseStockNumber(form.low_stock_threshold, 'Low-stock level');
    const countValue = 'value' in count ? count.value : null;
    const thresholdValue = 'value' in threshold ? threshold.value : null;
    const trackedChanged = form.track_stock !== savedStock.tracked;
    const countChanged = form.track_stock && countValue !== null && (!savedStock.tracked || countValue !== savedStock.on_hand);
    const thresholdChanged = thresholdValue !== null && thresholdValue !== savedStock.low_stock_threshold;
    if (!trackedChanged && !countChanged && !thresholdChanged) return null;
    // A new product: only worth a call once tracking is on.
    if (!isEditing && !form.track_stock) return null;
    const body: SetStockInput = { tracked: form.track_stock };
    if (countChanged && countValue !== null) body.stock_count = countValue;
    if (thresholdChanged && thresholdValue !== null) body.low_stock_threshold = thresholdValue;
    if (form.stock_reason.trim()) body.reason = form.stock_reason.trim();
    return body;
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    const lead = parseLeadDays(form.delivery_lead_days);
    if ('error' in lead) next.delivery_lead_days = lead.error;
    if (!hasVariants) {
      const count = parseStockNumber(form.stock_count, 'Stock count');
      if ('error' in count) next.stock_count = count.error;
      const threshold = parseStockNumber(form.low_stock_threshold, 'Low-stock level');
      if ('error' in threshold) next.low_stock_threshold = threshold.error;
    }
    if (!form.category_id) next.category_id = 'Choose a category';
    if (form.name.trim().length < 2) next.name = 'Enter the product name';
    if (form.sku.trim().length < 3) next.sku = 'SKU must be at least 3 characters';
    if (form.unit.trim().length < 1) next.unit = 'Enter the unit, e.g. 1 L';
    // Optional: empty = 0, not set yet (owner, 2026-10-21) - but Markup needs it.
    if (cost === null) next.purchase_cost = 'Enter a valid cost';
    else if (form.pricing_mode === 'MARKUP' && !(cost > 0)) next.purchase_cost = COST_REQUIRED_FOR_MARKUP;
    if (form.pricing_mode === 'FIXED') {
      const fixed = parseSellingPrice(form.fixed_selling_price);
      if ('error' in fixed) next.fixed_selling_price = fixed.error;
    } else {
      const markup = parseMarkupPercent(form.custom_markup_percent);
      if ('error' in markup) next.custom_markup_percent = markup.error;
    }
    // MRP (migration 048): optional, above 0.
    const mrp = parseMrpInput(form.mrp);
    if ('error' in mrp) next.mrp = mrp.error;
    // Offer (owner, 2026-10-09). An ended offer left as it is does not block
    // an unrelated edit; anything the operator touches is checked.
    if (offerParsed && 'error' in offerParsed && (offerPriceChanged || offerEndChanged || !offerEnded)) {
      next.offer_price = offerParsed.error;
    }
    if (form.offer_end_day !== '') {
      if (offerText === '') next.offer_end_day = 'Enter an offer price first';
      else if (offerEndChanged && form.offer_end_day < colomboTodayDay()) next.offer_end_day = 'Pick today or a later day';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
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
      image_focal_x: form.image_focal.x,
      image_focal_y: form.image_focal.y,
      // Empty = 0: no cost price yet (owner, 2026-10-21).
      purchase_cost: cost ?? 0,
      pricing_mode: form.pricing_mode,
      is_available: form.is_available,
      is_active: form.is_active,
      show_offer_cut: form.show_offer_cut,
    };
    const lead = parseLeadDays(form.delivery_lead_days);
    payload.delivery_lead_days = 'value' in lead ? lead.value : 0;
    // Only the active mode's own field goes (backend contract): Markup sends
    // its custom markup (null = inherit), Fixed sends its price. The other
    // stays stored on the server, ignored while unused.
    if (form.pricing_mode === 'FIXED') {
      payload.fixed_selling_price = Number(form.fixed_selling_price.trim());
    } else {
      const markup = parseMarkupPercent(form.custom_markup_percent);
      payload.custom_markup_percent = 'value' in markup ? markup.value : null;
    }
    // MRP (migration 048): sent only when it changed (blank clears it), so an
    // unrelated edit never re-checks the running offer against it.
    const mrpText = form.mrp.trim();
    if (mrpText !== savedMrp) payload.mrp = mrpText === '' ? null : Number(mrpText);
    // Offer fields go only when they changed (owner, 2026-10-09): resending
    // an untouched end date the form only knows as a day could move it.
    // An emptied price removes the offer, and the backend clears its end too.
    // In "LKR off" mode the price sent is selling price - amount (owner,
    // 2026-10-10); the backend stores only that price, so a later cost or
    // markup change keeps it, exactly like an offer typed as a price.
    if (offerText === '') {
      if (savedOffer.price !== '') payload.offer_price = null;
    } else {
      if (offerPriceChanged && offerParsed && 'value' in offerParsed) payload.offer_price = offerParsed.value;
      if (offerEndChanged) payload.offer_ends_at = form.offer_end_day === '' ? null : offerEndForDay(form.offer_end_day);
    }

    setSaving(true);
    try {
      const saved = isEditing && id ? await catalog.products.update(id, payload) : await catalog.products.create(payload);
      // Saved: only now is the replaced (or removed) file safe to delete.
      void deleteImagesQuietly(replacedImages([savedImageUrl], [form.image_url]));
      // Stock (migration 045): its own call, only when the section changed;
      // for a new product right after it exists.
      const stockBody = stockChange();
      const productId = isEditing && id ? id : saved?.id;
      if (stockBody && productId) {
        try {
          const result = await inventoryApi.stock.setStock(productId, stockBody);
          setSavedStock(result.stock);
        } catch (err) {
          setServerError(`${form.name.trim()} was saved, but its stock was not: ${catalogErrorMessage(err)}`);
          if (!isEditing) navigate(`/catalog/products/${productId}`, { replace: true });
          return;
        }
      }
      // A fixed price below cost saves (owner rule), and the list says so.
      const warning = saved?.price_warning?.message;
      navigate('/catalog/products', warning ? { state: { notice: `${form.name.trim()} saved. ${warning}` } } : undefined);
    } catch (err) {
      // An MRP the server refused shows under the MRP field (migration 048).
      const mrpError = serverFieldError(err, 'mrp');
      if (mrpError) {
        setErrors((current) => ({ ...current, mrp: mrpError }));
        setServerError('Check the MRP and save again.');
      } else {
        setServerError(catalogErrorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Loading product" />;

  return (
    <div className="page">
      <PageHeader
        title={isEditing ? 'Edit product' : 'Add product'}
        description="Customers never see purchase cost or markup - only the calculated selling price."
      />

      <form className="form" onSubmit={handleSubmit}>
        <section className="form__section">
          <h2 className="form__section-title">Details</h2>
          <Field label="Product name" error={errors.name}>
            <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Category" error={errors.category_id}>
            <select className="input" value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
              <option value="">Select a category</option>
              {pickerOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </Field>
          <div className="form__row">
            <Field label="SKU" error={errors.sku}>
              <input className="input" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
            </Field>
            <Field label="Barcode" hint="Optional">
              <input className="input" value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
            </Field>
          </div>
          <div className="form__row">
            <Field label="Unit" hint="e.g. 1 L, 500 g" error={errors.unit}>
              <input className="input" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
            </Field>
            <Field label="Pack size" hint="Optional, e.g. Tetra Pack">
              <input className="input" value={form.pack_size} onChange={(event) => setForm({ ...form, pack_size: event.target.value })} />
            </Field>
          </div>
          <Field label="Description" hint="Shown on the product page when present">
            <textarea className="input" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
        </section>

        <section className="form__section">
          <h2 className="form__section-title">Image</h2>
          <ImageUploader
            value={form.image_url}
            folder="products"
            label="Product image"
            onChange={(url) => setForm({ ...form, image_url: url })}
            focal={form.image_focal}
            onFocalChange={(image_focal) => setForm({ ...form, image_focal })}
            // A product tile is square in every customer grid, so that is the
            // shape the preview must be drawn at.
            focalShape="square"
          />
        </section>

        <section className="form__section" aria-labelledby="pricing-title">
          <h2 className="form__section-title" id="pricing-title">
            Pricing
          </h2>
          <Field label="Cost price (LKR)" hint="Optional. Leave empty until the supplier confirms it." error={errors.purchase_cost}>
            <input className="input" inputMode="decimal" value={form.purchase_cost} onChange={(event) => setForm({ ...form, purchase_cost: event.target.value })} />
          </Field>
          <p className="field__label" id="pricing-mode-label">
            Selling price
          </p>
          <div className="segmented offer-mode" role="radiogroup" aria-labelledby="pricing-mode-label">
            {PRICING_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={option.value === form.pricing_mode}
                className={option.value === form.pricing_mode ? 'segmented__item is-selected' : 'segmented__item'}
                onClick={() => setForm({ ...form, pricing_mode: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
          {form.pricing_mode === 'FIXED' ? (
            <>
              <Field label="Selling price (LKR)" hint="Customers pay exactly this" error={errors.fixed_selling_price}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.fixed_selling_price}
                  onChange={(event) => setForm({ ...form, fixed_selling_price: event.target.value })}
                />
              </Field>
              {margin !== null ? (
                <p className="form__note" aria-live="polite">
                  {`${percentText(margin)} over cost`}
                </p>
              ) : null}
              {belowCost ? (
                <p className="field__error" role="alert">
                  {`${belowCost}. You can still save it.`}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <Field
                label="Custom markup %"
                hint={customMarkupHint(selectedCategory?.name ?? null, inherited)}
                error={errors.custom_markup_percent}
              >
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.custom_markup_percent}
                  onChange={(event) => setForm({ ...form, custom_markup_percent: event.target.value })}
                />
              </Field>
              <p className="form__note" aria-live="polite">
                {preview?.markup
                  ? `Selling price LKR ${preview.price.toFixed(2)} (${markupSourceText(preview.markup)})`
                  : 'Enter the cost price to see the selling price.'}
              </p>
            </>
          )}
          <Field
            label="MRP (LKR)"
            hint="Optional. The Maximum Retail Price on the pack. If the selling price is higher, customers pay the MRP"
            error={errors.mrp}
          >
            <input className="input" inputMode="decimal" value={form.mrp} onChange={(event) => setForm({ ...form, mrp: event.target.value })} />
          </Field>
          {previewCapped?.capped && previewPrice !== null ? (
            <>
              <p className="form__note" aria-live="polite">{`Selling price LKR ${previewCapped.price.toFixed(2)} (the MRP)`}</p>
              <p className="form__note mrp-capped" role="status">
                {mrpCappedNote(form.pricing_mode, previewPrice)}
              </p>
            </>
          ) : previewPrice !== null && mrpValue != null && previewPrice < mrpValue ? (
            <p className="form__note" aria-live="polite">
              {`Below the MRP (LKR ${mrpValue.toFixed(2)}): customers see the MRP struck through next to the price.`}
            </p>
          ) : null}
          <p className="field__hint">The server works the selling price out again when you save.</p>
        </section>

        <section className="form__section" aria-labelledby="offer-title">
          <h2 className="form__section-title" id="offer-title">
            Offer
          </h2>
          {offerEnded ? (
            <p className="offer-summary">
              <span className="offer-tag offer-tag--ended">Offer ended on {formatColomboDate(savedOffer.endsAt!)}</span>
              Customers pay the selling price. Pick a new end date or remove the offer.
            </p>
          ) : savedOffer.active && !offerPriceChanged && !offerEndChanged ? (
            <p className="offer-summary">
              <span className="offer-tag">On offer now</span>
            </p>
          ) : null}
          <div className="segmented offer-mode" role="group" aria-label="Offer as">
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
              <Field label="Amount off (LKR)" hint="Taken off the selling price. Leave blank for no offer" error={errors.offer_price}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.offer_off}
                  onChange={(event) => setForm({ ...form, offer_off: event.target.value })}
                />
              </Field>
            ) : (
              <Field label="Offer price (LKR)" hint="Leave blank for no offer" error={errors.offer_price}>
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.offer_price}
                  onChange={(event) => setForm({ ...form, offer_price: event.target.value })}
                />
              </Field>
            )}
            <Field label="Offer ends" hint="Optional - the offer runs to the end of this day" error={errors.offer_end_day}>
              <input
                className="input"
                type="date"
                value={form.offer_end_day}
                // No floor while showing a stored end that has passed: the
                // browser would otherwise refuse to submit the whole form.
                min={offerEnded ? undefined : colomboTodayDay()}
                onChange={(event) => setForm({ ...form, offer_end_day: event.target.value })}
              />
            </Field>
          </div>
          {offerParsed && 'value' in offerParsed && sellingForOffer !== null && form.offer_mode === 'off' ? (
            <p className="form__note" role="status">
              {`Customers pay LKR ${offerParsed.value.toFixed(2)} (was LKR ${sellingForOffer.toFixed(2)})${
                form.offer_end_day ? ` until ${formatColomboDate(offerEndForDay(form.offer_end_day))}` : ''
              }.`}
            </p>
          ) : offerParsed && 'value' in offerParsed && sellingForOffer !== null ? (
            <p className="form__note" role="status">
              {`${percentOff(offerParsed.value, sellingForOffer)}% off - customers pay LKR ${offerParsed.value.toFixed(2)} instead of LKR ${sellingForOffer.toFixed(2)}${
                form.offer_end_day ? ` until ${formatColomboDate(offerEndForDay(form.offer_end_day))}` : ''
              }.`}
            </p>
          ) : null}
          {offerText === '' && savedOffer.price !== '' ? (
            <p className="form__note">The offer is removed when you save.</p>
          ) : null}
          {offerText !== '' || form.offer_end_day !== '' ? (
            <div className="offer-actions">
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setForm({ ...form, offer_price: '', offer_off: '', offer_end_day: '' })}
              >
                Remove offer
              </button>
            </div>
          ) : null}
          <label className="toggle">
            <input type="checkbox" checked={form.show_offer_cut} onChange={(event) => setForm({ ...form, show_offer_cut: event.target.checked })} />
            <span>
              <strong>Show offer price cut</strong>
              <em>Customers see the old price struck through and how much they save (offer or MRP).</em>
            </span>
          </label>
        </section>

        <section className="form__section" aria-labelledby="stock-title">
          <h2 className="form__section-title" id="stock-title">
            Stock
          </h2>
          {hasVariants ? (
            <p className="form__note">This product has variants, so stock is set per variant below.</p>
          ) : (
            <StockFields form={form} setForm={setForm} errors={errors} stock={isEditing ? savedStock : null} />
          )}
        </section>

        {isEditing && id ? <ProductAdLinks productId={id} productName={form.name} /> : null}


        <section className="form__section">
          <h2 className="form__section-title">Availability</h2>
          <Field
            label="Delivery lead time (days)"
            hint="Customers can pick delivery from today + N days. 0 = same day."
            error={errors.delivery_lead_days}
          >
            <input
              className="input"
              inputMode="numeric"
              value={form.delivery_lead_days}
              onChange={(event) => setForm({ ...form, delivery_lead_days: event.target.value })}
            />
          </Field>
          <label className="toggle">
            <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
            <span>
              <strong>Active</strong>
              <em>Inactive products disappear from the customer catalog.</em>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={form.is_available} onChange={(event) => setForm({ ...form, is_available: event.target.checked })} />
            <span>
              <strong>Available</strong>
              <em>Unavailable products are shown but cannot be added to a cart.</em>
            </span>
          </label>
        </section>

        {serverError ? <p className="field__error">{serverError}</p> : null}

        <div className="form__actions">
          <button type="button" className="button button--ghost" onClick={() => navigate('/catalog/products')}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : isEditing ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </form>

      {isEditing && savedProduct ? (
        <ProductVariants product={savedProduct} variants={variants} globalMarkup={globalMarkup} onChange={setVariants} />
      ) : (
        <section className="form__section" aria-labelledby="variants-title">
          <h2 className="form__section-title" id="variants-title">
            Variants
          </h2>
          <p className="form__note">
            Save the product first to add variants (sizes or packs with their own price, e.g. 50 g, 100 g).
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * The product's own stock (migration 045): tracking, count and low-stock
 * level, with what is on hand / in open orders / sellable right now. Staff
 * only - customers never see a count, and can order until it reaches 0.
 */
function StockFields({
  form,
  setForm,
  errors,
  stock,
}: {
  form: FormState;
  setForm(next: FormState): void;
  errors: Record<string, string>;
  /** The saved stock (edit), null for a new product. */
  stock: StaffStock | null;
}) {
  const badge = staffStockBadge(stock);
  return (
    <>
      <p className="form__note">Customers never see the count. They can order until it reaches 0, then it shows as sold out.</p>
      <label className="toggle">
        <input type="checkbox" checked={form.track_stock} onChange={(event) => setForm({ ...form, track_stock: event.target.checked })} />
        <span>
          <strong>Track stock</strong>
          <em>Off: sourced on order, never limited.</em>
        </span>
      </label>
      {stock?.tracked ? (
        <>
          <dl className="stock-figures" aria-label="Current stock">
            <div>
              <dt>On hand</dt>
              <dd>{stock.on_hand}</dd>
            </div>
            <div>
              <dt>In open orders</dt>
              <dd>{stock.in_open_orders}</dd>
            </div>
            <div>
              <dt>Can sell</dt>
              <dd>{stock.sellable ?? 0}</dd>
            </div>
          </dl>
          {badge && badge.kind !== 'IN_STOCK' ? (
            <p>
              <span className={`stock stock--${badge.kind.toLowerCase()}`}>
                <span className="stock__word">{badge.kind === 'OUT' ? 'Sold out' : 'Low'}</span>
              </span>
            </p>
          ) : null}
        </>
      ) : null}
      <div className="form__row">
        <Field label="Stock count" hint="Units on the shelf now" error={errors.stock_count}>
          <input
            className="input input--mono"
            inputMode="numeric"
            disabled={!form.track_stock}
            value={form.stock_count}
            onChange={(event) => setForm({ ...form, stock_count: event.target.value })}
          />
        </Field>
        <Field label="Low-stock level" hint="Listed under Running low at or below this" error={errors.low_stock_threshold}>
          <input
            className="input input--mono"
            inputMode="numeric"
            value={form.low_stock_threshold}
            onChange={(event) => setForm({ ...form, low_stock_threshold: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Reason" hint="Optional, kept in the stock ledger, e.g. Shelf count">
        <input className="input" value={form.stock_reason} onChange={(event) => setForm({ ...form, stock_reason: event.target.value })} />
      </Field>
    </>
  );
}

/**
 * What a blank "Custom markup %" means right now, in the operator's words:
 * the chosen category's markup, else its parent's, else the global one.
 */
export function customMarkupHint(categoryName: string | null, inherited: ResolvedMarkup): string {
  const pct = percentText(inherited.percent);
  if (inherited.source === 'CATEGORY_MARKUP') return `Leave blank to use the category markup (${inherited.categoryName} ${pct})`;
  if (inherited.source === 'PARENT_CATEGORY_MARKUP') {
    return `Leave blank to use the parent category markup (${inherited.categoryName} ${pct}), as ${categoryName ?? 'this category'} has none`;
  }
  if (categoryName) return `Leave blank to use the global markup (${pct}), as ${categoryName} has no markup`;
  return `Leave blank to use the category markup, or the global markup (${pct}) if the category has none`;
}
