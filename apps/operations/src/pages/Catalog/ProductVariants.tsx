import { useMemo, useRef, useState, type FormEvent } from 'react';
import { catalog, inventory as inventoryApi } from '../../api/resources';
import type { AdminProduct, PricingMode, SetStockInput, StaffVariant } from '../../api/types';
import { Badge, ConfirmDialog, Field, Spinner } from '../../components/ui';
import {
  catalogErrorMessage,
  colomboDay,
  colomboTodayDay,
  formatColomboDate,
  offerEndForDay,
  parseOfferPrice,
  parseStockNumber,
  percentOff,
} from '../../lib/catalog';
import { staffStockBadge } from '../../lib/inventory';
import {
  FALLBACK_DEFAULT_MARKUP_PERCENT,
  belowCostText,
  capAtMrp,
  mrpCappedNote,
  parseMarkupPercent,
  parseMrpInput,
  parseSellingPrice,
  percentText,
  resolveVariantPrice,
  variantPricingSourceLabel,
  type ResolvedVariantPrice,
} from '../../lib/pricing';

/**
 * Variants of a product (migration 045; owner, 2026-10-14): "chilli powder
 * has 50g, 100g, 250g, 500g with different prices". Each variant has its own
 * purchase cost, price (Fixed, or Markup: the variant's own markup, else the
 * product's, category, parent, global), offer, switches and stock.
 *
 * Every change here is saved straight away through the variant endpoints
 * (the product's own Save button is not needed). Customers see a price
 * range on the tile and pick a variant; they never see costs or stock.
 */
export function ProductVariants({
  product,
  variants,
  globalMarkup,
  onChange,
}: {
  /** The saved product (its markups are the variant price fallbacks). */
  product: AdminProduct;
  variants: StaffVariant[];
  /** The global default markup setting, when the product response lacks it. */
  globalMarkup: number | null;
  onChange(variants: StaffVariant[]): void;
}) {
  const [editing, setEditing] = useState<StaffVariant | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StaffVariant | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(() => [...variants].sort((a, b) => a.sort_order - b.sort_order), [variants]);

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length || busy) return;
    const order = [...sorted];
    [order[index], order[target]] = [order[target]!, order[index]!];
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await catalog.products.variants.reorder(
        product.id,
        order.map((v) => v.id)
      );
      onChange(saved);
      setNotice('Variant order saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(variant: StaffVariant) {
    setPendingDelete(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await catalog.products.variants.remove(product.id, variant.id);
      onChange(variants.filter((v) => v.id !== variant.id));
      setNotice(
        result.mode === 'SOFT'
          ? `${variant.label} was archived. It was ordered before, so past orders keep it.`
          : `${variant.label} was removed.`
      );
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form__section" aria-labelledby="variants-title">
      <h2 className="form__section-title" id="variants-title">
        Variants
      </h2>
      <p className="form__note">
        Sizes or packs with their own price, e.g. 50 g, 100 g, 3 pack. Customers see the price range and pick one. Changes
        here save straight away.
      </p>
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {sorted.length === 0 ? <p className="quiet">No variants. This product is sold as one item.</p> : null}
      {sorted.length > 0 ? (
        <ul className="variant-list" aria-label="Variants">
          {sorted.map((variant, index) => {
            const stock = staffStockBadge(variant.stock);
            return (
              <li key={variant.id} className={variant.is_active ? 'variant-row' : 'variant-row is-muted'}>
                <div className="variant-row__main">
                  <p className="variant-row__title">{variant.label}</p>
                  <p className="cat-row__meta">
                    {variant.sku ?? 'No SKU'} · cost LKR {Number(variant.purchase_cost).toFixed(2)}
                  </p>
                  <p className="cat-row__price">
                    LKR {Number(variant.selling_price).toFixed(2)}
                    {variant.mrp != null ? <span className="cat-row__meta"> · MRP LKR {Number(variant.mrp).toFixed(2)}</span> : null}
                  </p>
                  {/* Migration 048: the size's price is its MRP. */}
                  {variant.mrp_capped && variant.computed_selling_price != null ? (
                    <p className="mrp-capped">{mrpCappedNote(variant.pricing_mode, Number(variant.computed_selling_price))}</p>
                  ) : null}
                  <div className="cat-row__badges product-chips">
                    <Badge tone={variant.is_active ? 'active' : 'inactive'}>{variant.is_active ? 'Active' : 'Inactive'}</Badge>
                    {!variant.is_available ? <Badge tone="muted">Unavailable</Badge> : null}
                    <Badge tone="muted">{variantPricingSourceLabel(variant.pricing_source)}</Badge>
                    {variant.price_warning ? <Badge tone="inactive">Below cost</Badge> : null}
                    {variant.offer_active && variant.offer_price != null ? (
                      <span className="offer-tag">Offer LKR {Number(variant.offer_price).toFixed(2)}</span>
                    ) : null}
                    {stock ? (
                      <span className={`stock stock--${stock.kind.toLowerCase()}`}>
                        <span className="stock__word">{stock.label}</span>
                      </span>
                    ) : (
                      <span className="chip">Stock not tracked</span>
                    )}
                  </div>
                </div>
                <div className="variant-row__actions">
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Move ${variant.label} up`}
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Move ${variant.label} down`}
                    disabled={busy || index === sorted.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Edit ${variant.label}`}
                    disabled={busy}
                    onClick={() => {
                      setNotice(null);
                      setEditing(variant);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Delete ${variant.label}`}
                    disabled={busy}
                    onClick={() => setPendingDelete(variant)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="offer-actions">
        <button
          type="button"
          className="button button--sm"
          disabled={busy}
          onClick={() => {
            setNotice(null);
            setEditing('new');
          }}
        >
          Add variant
        </button>
      </div>

      {editing ? (
        <VariantDialog
          product={product}
          variant={editing === 'new' ? null : editing}
          nextSortOrder={sorted.length === 0 ? 0 : Math.max(...sorted.map((v) => v.sort_order)) + 1}
          globalMarkup={globalMarkup}
          onClose={() => setEditing(null)}
          onSaved={(saved, message) => {
            const exists = variants.some((v) => v.id === saved.id);
            onChange(exists ? variants.map((v) => (v.id === saved.id ? saved : v)) : [...variants, saved]);
            setNotice(message);
          }}
          onDone={() => setEditing(null)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete variant"
          message={`Delete ${pendingDelete.label}? If it was ever ordered it is archived instead, so past orders keep it.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </section>
  );
}

interface VariantFormState {
  label: string;
  sku: string;
  barcode: string;
  purchase_cost: string;
  pricing_mode: PricingMode;
  custom_markup_percent: string;
  fixed_selling_price: string;
  /** Migration 048: this size's MRP; '' = none. */
  mrp: string;
  offer_price: string;
  offer_end_day: string;
  is_active: boolean;
  is_available: boolean;
  track_stock: boolean;
  stock_count: string;
  low_stock_threshold: string;
  reason: string;
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v));

function initialState(variant: StaffVariant | null): VariantFormState {
  if (!variant) {
    return {
      label: '',
      sku: '',
      barcode: '',
      purchase_cost: '',
      pricing_mode: 'MARKUP',
      custom_markup_percent: '',
      fixed_selling_price: '',
      mrp: '',
      offer_price: '',
      offer_end_day: '',
      is_active: true,
      is_available: true,
      track_stock: false,
      stock_count: '',
      low_stock_threshold: '5',
      reason: '',
    };
  }
  return {
    label: variant.label,
    sku: variant.sku ?? '',
    barcode: variant.barcode ?? '',
    purchase_cost: str(variant.purchase_cost),
    pricing_mode: variant.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP',
    custom_markup_percent: str(variant.custom_markup_percent),
    fixed_selling_price: str(variant.fixed_selling_price),
    mrp: str(variant.mrp),
    offer_price: str(variant.offer_price),
    offer_end_day: variant.offer_ends_at ? colomboDay(variant.offer_ends_at) : '',
    is_active: variant.is_active,
    is_available: variant.is_available,
    track_stock: variant.stock?.tracked ?? false,
    stock_count: variant.stock?.tracked ? String(variant.stock.on_hand) : '',
    low_stock_threshold: String(variant.stock?.low_stock_threshold ?? 5),
    reason: '',
  };
}

const PRICING_MODES: Array<{ value: PricingMode; label: string }> = [
  { value: 'MARKUP', label: 'Markup' },
  { value: 'FIXED', label: 'Fixed price' },
];

/** "(variant markup 30%)" style explanation of a variant price. */
export function variantPriceSourceText(resolved: Pick<ResolvedVariantPrice, 'pricingSource' | 'effectiveMarkupPercent'>): string {
  const pct = percentText(Number(resolved.effectiveMarkupPercent ?? 0));
  switch (resolved.pricingSource) {
    case 'VARIANT_MARKUP':
      return `variant markup ${pct}`;
    case 'PRODUCT_MARKUP':
      return `product markup ${pct}`;
    case 'CATEGORY_MARKUP':
      return `category markup ${pct}`;
    case 'PARENT_CATEGORY_MARKUP':
      return `parent category markup ${pct}`;
    case 'GLOBAL_MARKUP':
      return `global markup ${pct}`;
    default:
      return 'fixed price';
  }
}

function VariantDialog({
  product,
  variant,
  nextSortOrder,
  globalMarkup,
  onClose,
  onSaved,
  onDone,
}: {
  product: AdminProduct;
  variant: StaffVariant | null;
  nextSortOrder: number;
  globalMarkup: number | null;
  onClose(): void;
  onSaved(variant: StaffVariant, message: string): void;
  onDone(): void;
}) {
  const [form, setForm] = useState<VariantFormState>(() => initialState(variant));
  const saved = useMemo(() => initialState(variant), [variant]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const isNew = variant === null;

  const cost = useMemo(() => {
    const s = form.purchase_cost.trim();
    const n = Number(s);
    return s !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  }, [form.purchase_cost]);

  /** Preview only: the backend twin (lib/pricing.ts resolveVariantPrice); the server recomputes on save. */
  const preview = useMemo((): ResolvedVariantPrice | null => {
    let markup: number | null = null;
    if (form.pricing_mode === 'FIXED') {
      if ('error' in parseSellingPrice(form.fixed_selling_price)) return null;
    } else {
      const parsed = parseMarkupPercent(form.custom_markup_percent);
      if ('error' in parsed) return null;
      markup = parsed.value;
    }
    if (cost === null && form.pricing_mode === 'MARKUP') return null;
    try {
      return resolveVariantPrice({
        purchaseCost: cost ?? 0,
        pricingMode: form.pricing_mode,
        fixedSellingPrice: form.fixed_selling_price.trim(),
        variantMarkupPercent: markup,
        productMarkupPercent: product.custom_markup_percent,
        categoryMarkupPercent: product.category_markup_percent,
        parentCategoryMarkupPercent: product.parent_category_markup_percent,
        globalMarkupPercent: product.global_markup_percent ?? globalMarkup ?? FALLBACK_DEFAULT_MARKUP_PERCENT,
      });
    } catch {
      return null;
    }
  }, [form.pricing_mode, form.fixed_selling_price, form.custom_markup_percent, cost, product, globalMarkup]);
  // Migration 048: the size's MRP caps its price.
  const mrpParsed = parseMrpInput(form.mrp);
  const mrpValue = 'value' in mrpParsed ? mrpParsed.value : undefined;
  const capped = preview ? capAtMrp(preview.sellingPrice, mrpValue) : null;
  const previewPrice = capped?.price ?? variant?.selling_price ?? null;
  const belowCost =
    capped && cost !== null && (preview?.pricingMode === 'FIXED' || capped.capped) ? belowCostText(cost, capped.price) : null;

  const offerText = form.offer_price.trim();
  const offerRaw = offerText === '' ? null : parseOfferPrice(form.offer_price, previewPrice);
  const offerParsed =
    offerRaw && 'error' in offerRaw && capped?.capped && offerRaw.error.startsWith('The offer price must be lower')
      ? { error: offerRaw.error.replace(/\)\.$/, ', capped at the MRP).') }
      : offerRaw;
  const offerPriceChanged = offerText !== saved.offer_price;
  const offerEndChanged = form.offer_end_day !== saved.offer_end_day;

  const countParsed = parseStockNumber(form.stock_count, 'Stock count');
  const thresholdParsed = parseStockNumber(form.low_stock_threshold, 'Low-stock level');

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.label.trim() === '') next.label = 'Enter the variant name, e.g. 100 g or 3 pack';
    else if (form.label.trim().length > 64) next.label = 'The variant name must be at most 64 characters';
    const sku = form.sku.trim();
    if (sku && (sku.length < 3 || sku.length > 64)) next.sku = 'SKU must be 3 to 64 characters (or leave it empty)';
    else if (sku && sku === product.sku) next.sku = "Use a different SKU from the product's (or leave it empty)";
    if (cost === null) next.purchase_cost = 'Enter a valid cost';
    if (form.pricing_mode === 'FIXED') {
      const fixed = parseSellingPrice(form.fixed_selling_price);
      if ('error' in fixed) next.fixed_selling_price = fixed.error;
    } else {
      const markup = parseMarkupPercent(form.custom_markup_percent);
      if ('error' in markup) next.custom_markup_percent = markup.error;
    }
    if ('error' in mrpParsed) next.mrp = mrpParsed.error;
    if (offerParsed && 'error' in offerParsed && (offerPriceChanged || offerEndChanged || form.mrp !== saved.mrp)) next.offer_price = offerParsed.error;
    if (form.offer_end_day !== '') {
      if (offerText === '') next.offer_end_day = 'Enter an offer price first';
      else if (offerEndChanged && form.offer_end_day < colomboTodayDay()) next.offer_end_day = 'Pick today or a later day';
    }
    if ('error' in countParsed) next.stock_count = countParsed.error;
    if ('error' in thresholdParsed) next.low_stock_threshold = thresholdParsed.error;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function pricingFields(): Record<string, unknown> {
    if (form.pricing_mode === 'FIXED') return { pricing_mode: 'FIXED', fixed_selling_price: Number(form.fixed_selling_price.trim()) };
    const markup = parseMarkupPercent(form.custom_markup_percent);
    return { pricing_mode: 'MARKUP', custom_markup_percent: 'value' in markup ? markup.value : null };
  }

  /** The stock call for an existing variant, or null when nothing in the stock fields changed. */
  function stockChange(): SetStockInput | null {
    if (!variant) return null;
    const count = 'value' in countParsed ? countParsed.value : null;
    const threshold = 'value' in thresholdParsed ? thresholdParsed.value : null;
    const trackedChanged = form.track_stock !== saved.track_stock;
    const countChanged = form.track_stock && count !== null && (!saved.track_stock || count !== variant.stock.on_hand);
    const thresholdChanged = threshold !== null && threshold !== variant.stock.low_stock_threshold;
    if (!trackedChanged && !countChanged && !thresholdChanged) return null;
    const body: SetStockInput = { variant_id: variant.id, tracked: form.track_stock };
    if (countChanged && count !== null) body.stock_count = count;
    if (thresholdChanged && threshold !== null) body.low_stock_threshold = threshold;
    if (form.reason.trim()) body.reason = form.reason.trim();
    return body;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (submitting.current) return;
    setServerError(null);
    if (!validate()) return;
    submitting.current = true;
    setBusy(true);
    const common: Record<string, unknown> = {
      label: form.label.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      purchase_cost: cost,
      ...pricingFields(),
      // Migration 048: the size's MRP - only when set (new) or changed (blank clears it).
      ...((variant ? form.mrp.trim() !== saved.mrp.trim() : form.mrp.trim() !== '') ? { mrp: 'value' in mrpParsed ? mrpParsed.value : null } : {}),
      is_active: form.is_active,
      is_available: form.is_available,
    };
    try {
      if (!variant) {
        const body: Record<string, unknown> = { ...common, sort_order: nextSortOrder };
        if (offerParsed && 'value' in offerParsed) {
          body.offer_price = offerParsed.value;
          if (form.offer_end_day) body.offer_ends_at = offerEndForDay(form.offer_end_day);
        }
        body.track_stock = form.track_stock;
        if (form.track_stock && 'value' in countParsed && countParsed.value !== null) body.stock_count = countParsed.value;
        if ('value' in thresholdParsed && thresholdParsed.value !== null) body.low_stock_threshold = thresholdParsed.value;
        const created = await catalog.products.variants.create(product.id, body);
        onSaved(created, `${created.label} added.`);
        onDone();
        return;
      }
      // Offer fields go only when they changed (as on the product form).
      const body: Record<string, unknown> = { ...common };
      if (offerText === '') {
        if (saved.offer_price !== '') body.offer_price = null;
      } else {
        if (offerPriceChanged && offerParsed && 'value' in offerParsed) body.offer_price = offerParsed.value;
        if (offerEndChanged) body.offer_ends_at = form.offer_end_day === '' ? null : offerEndForDay(form.offer_end_day);
      }
      let updated = await catalog.products.variants.update(product.id, variant.id, body);
      const stockBody = stockChange();
      if (stockBody) {
        try {
          const result = await inventoryApi.stock.setStock(product.id, stockBody);
          updated = { ...updated, stock: result.stock };
        } catch (err) {
          onSaved(updated, `${updated.label} saved.`);
          setServerError(`${updated.label} was saved, but its stock was not: ${catalogErrorMessage(err)}`);
          return;
        }
      }
      onSaved(updated, `${updated.label} saved.`);
      onDone();
    } catch (err) {
      setServerError(catalogErrorMessage(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const title = variant ? `Edit ${variant.label}` : 'Add variant';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <form className="modal__panel modal__panel--wide form" onSubmit={submit}>
        <h2 className="modal__title">{title}</h2>
        <Field label="Variant name" hint="e.g. 50 g, 100 g, 1 piece, 3 pack" error={errors.label}>
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
        <div className="form__row">
          <Field label="Variant SKU" hint="Optional" error={errors.sku}>
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </Field>
          <Field label="Variant barcode" hint="Optional">
            <input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
          </Field>
        </div>
        <Field label="Variant purchase cost (LKR)" error={errors.purchase_cost}>
          <input
            className="input"
            inputMode="decimal"
            value={form.purchase_cost}
            onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
          />
        </Field>
        <p className="field__label" id="variant-pricing-mode-label">
          Variant selling price
        </p>
        <div className="segmented offer-mode" role="radiogroup" aria-labelledby="variant-pricing-mode-label">
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
          <Field label="Price (LKR)" hint="Customers pay exactly this" error={errors.fixed_selling_price}>
            <input
              className="input"
              inputMode="decimal"
              value={form.fixed_selling_price}
              onChange={(e) => setForm({ ...form, fixed_selling_price: e.target.value })}
            />
          </Field>
        ) : (
          <Field
            label="Variant markup %"
            hint="Leave blank to use the product markup, else the category or global markup"
            error={errors.custom_markup_percent}
          >
            <input
              className="input"
              inputMode="decimal"
              value={form.custom_markup_percent}
              onChange={(e) => setForm({ ...form, custom_markup_percent: e.target.value })}
            />
          </Field>
        )}
        <Field
          label="MRP (LKR)"
          hint="Optional. This size's printed Maximum Retail Price. If its selling price is higher, customers pay the MRP"
          error={errors.mrp}
        >
          <input className="input" inputMode="decimal" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
        </Field>
        {preview && capped?.capped ? (
          <>
            <p className="form__note" aria-live="polite">{`Selling price LKR ${capped.price.toFixed(2)} (the MRP)`}</p>
            <p className="form__note mrp-capped" role="status">
              {mrpCappedNote(preview.pricingMode, preview.sellingPrice)}
            </p>
          </>
        ) : (
          <p className="form__note" aria-live="polite">
            {preview
              ? `Selling price LKR ${preview.sellingPrice.toFixed(2)} (${variantPriceSourceText(preview)})`
              : 'Enter the purchase cost to see the selling price.'}
          </p>
        )}
        {belowCost ? (
          <p className="field__error" role="alert">
            {`${belowCost}. You can still save it.`}
          </p>
        ) : null}

        <div className="form__row">
          <Field label="Variant offer price (LKR)" hint="Optional" error={errors.offer_price}>
            <input
              className="input"
              inputMode="decimal"
              value={form.offer_price}
              onChange={(e) => setForm({ ...form, offer_price: e.target.value })}
            />
          </Field>
          <Field label="Variant offer ends" hint="Optional" error={errors.offer_end_day}>
            <input
              className="input"
              type="date"
              value={form.offer_end_day}
              onChange={(e) => setForm({ ...form, offer_end_day: e.target.value })}
            />
          </Field>
        </div>
        {offerParsed && 'value' in offerParsed && previewPrice !== null ? (
          <p className="form__note" role="status">
            {`${percentOff(offerParsed.value, previewPrice)}% off - customers pay LKR ${offerParsed.value.toFixed(2)}${
              form.offer_end_day ? ` until ${formatColomboDate(offerEndForDay(form.offer_end_day))}` : ''
            }.`}
          </p>
        ) : null}

        <label className="toggle">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          <span>
            <strong>Variant active</strong>
            <em>Inactive variants are hidden from customers.</em>
          </span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={form.is_available} onChange={(e) => setForm({ ...form, is_available: e.target.checked })} />
          <span>
            <strong>Variant available</strong>
            <em>Unavailable variants show as sold out.</em>
          </span>
        </label>

        <label className="toggle">
          <input type="checkbox" checked={form.track_stock} onChange={(e) => setForm({ ...form, track_stock: e.target.checked })} />
          <span>
            <strong>Track stock for this variant</strong>
            <em>Customers never see the count. They can order until it reaches 0.</em>
          </span>
        </label>
        {variant?.stock?.tracked ? (
          <p className="form__note">
            {`On hand ${variant.stock.on_hand} · in open orders ${variant.stock.in_open_orders} · can sell ${variant.stock.sellable ?? 0}`}
          </p>
        ) : null}
        <div className="form__row">
          <Field label="Variant stock count" error={errors.stock_count}>
            <input
              className="input input--mono"
              inputMode="numeric"
              disabled={!form.track_stock}
              value={form.stock_count}
              onChange={(e) => setForm({ ...form, stock_count: e.target.value })}
            />
          </Field>
          <Field label="Variant low-stock level" error={errors.low_stock_threshold}>
            <input
              className="input input--mono"
              inputMode="numeric"
              value={form.low_stock_threshold}
              onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
            />
          </Field>
        </div>
        {!isNew ? (
          <Field label="Reason for a stock change" hint="Optional, kept in the ledger">
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        ) : null}

        {serverError ? (
          <p className="field__error" role="alert">
            {serverError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            {serverError && !isNew ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? <Spinner label="Saving" /> : isNew ? 'Add variant' : 'Save variant'}
          </button>
        </div>
      </form>
    </div>
  );
}
