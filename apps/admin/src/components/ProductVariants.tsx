import { useEffect, useMemo, useState } from 'react';
import { inventory as inventoryApi, products as productsApi } from '../api/resources';
import type { PricingMode, StaffStock, StaffVariant } from '../api/types';
import { errorMessage, splitServerErrors } from '../lib/apiErrors';
import { colomboDate, formatDay } from '../lib/coupons';
import { formatMoney } from '../lib/orders';
import {
  MAX_SELLING_PRICE,
  PRICING_SOURCE_LABEL,
  formatLkr,
  formatPercent,
  parseMarkupInput,
  resolveVariantPrice,
  variantSourceText,
  type ResolvedVariantPrice,
} from '../lib/pricing';
import { MAX_STOCK, parseWhole, stockBadge } from '../lib/stock';
import { Switch } from './Switch';
import { Badge, ConfirmDialog, Field, Spinner, useToast } from './ui';
import './productVariants.css';

/**
 * Variants (migration 045; owner, 2026-10-14): "chilli powder has 50 g,
 * 100 g, 250 g, 500 g with different prices". Each variant is saved on its
 * own (POST / PATCH / DELETE /admin/products/:id/variants), independent of
 * the product form's Save. Customers see the product as a price range and
 * pick a variant; they never see cost, markup or stock counts.
 */

/** The saved product's markups a variant in MARKUP mode falls back to. */
export interface VariantPricingContext {
  productMarkupPercent: number | null;
  categoryMarkupPercent: number | null;
  parentCategoryMarkupPercent: number | null;
  globalMarkupPercent: number | null;
}

const MONEY_INPUT = /^\d+(\.\d{1,2})?$/;
const MAX_PURCHASE_COST = 99_999_999.99;
const offerEndOf = (date: string) => `${date}T23:59:59+05:30`;
const PRICING_MODES: Array<{ value: PricingMode; label: string }> = [
  { value: 'MARKUP', label: 'Markup' },
  { value: 'FIXED', label: 'Fixed price' },
];
const VARIANT_FIELDS = [
  'label',
  'sku',
  'barcode',
  'purchase_cost',
  'custom_markup_percent',
  'fixed_selling_price',
  'offer_price',
  'offer_ends_at',
  'stock_count',
  'low_stock_threshold',
] as const;

/** A stock badge: Sold out / Low · n / n in stock; nothing when untracked. */
export function StockChip({ stock, untracked }: { stock: StaffStock | null | undefined; untracked?: string }) {
  const badge = stockBadge(stock);
  if (!badge) return untracked ? <span className="cell__secondary">{untracked}</span> : null;
  return <span className={`pv-chip pv-chip--${badge.tone}`}>{badge.text}</span>;
}

// ------------------------------------------------------------------ section
export function ProductVariants({
  productId,
  initial,
  pricing,
  onChange,
}: {
  productId: string;
  /** The product detail's variants; undefined = read them from the API. */
  initial: StaffVariant[] | undefined;
  pricing: VariantPricingContext;
  /** Called with the current list after every change (the form hides the product stock when there are variants). */
  onChange?(variants: StaffVariant[]): void;
}) {
  const toast = useToast();
  const [variants, setVariants] = useState<StaffVariant[] | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffVariant | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StaffVariant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let live = true;
    productsApi
      .listVariants(productId)
      .then((rows) => live && setVariants(rows))
      .catch((err) => {
        if (!live) return;
        setVariants([]);
        setLoadError(errorMessage(err, 'Could not load the variants.'));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  function update(next: StaffVariant[]) {
    const sorted = [...next].sort((a, b) => a.sort_order - b.sort_order);
    setVariants(sorted);
    onChange?.(sorted);
  }

  async function move(index: number, delta: -1 | 1) {
    if (!variants || busy) return;
    const target = index + delta;
    if (target < 0 || target >= variants.length) return;
    const ids = variants.map((v) => v.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setBusy(true);
    setError(null);
    try {
      update(await productsApi.reorderVariants(productId, ids));
    } catch (err) {
      setError(errorMessage(err, 'Could not change the order.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(variant: StaffVariant) {
    setPendingDelete(null);
    setBusy(true);
    setError(null);
    try {
      const result = await productsApi.removeVariant(productId, variant.id);
      toast.success(
        result.mode === 'SOFT'
          ? `${variant.label} archived: it has past orders, so it is hidden from customers and kept for their history.`
          : `${variant.label} removed.`
      );
      update((variants ?? []).filter((v) => v.id !== variant.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the variant.'));
    } finally {
      setBusy(false);
    }
  }

  function saved(variant: StaffVariant, close = true) {
    const list = variants ?? [];
    const exists = list.some((v) => v.id === variant.id);
    update(exists ? list.map((v) => (v.id === variant.id ? variant : v)) : [...list, variant]);
    if (close) setEditing(null);
  }

  return (
    <section className="form__section" aria-label="Variants">
      <h2 className="form__section-title">Variants</h2>
      <p className="form__note">
        Sizes or packs with their own price and stock, e.g. 50 g, 100 g, 250 g. Customers see the price range (LKR 50 - 350) and
        pick one. Each variant is saved as soon as you save it here.
      </p>
      {loadError ? <p className="field__error">{loadError}</p> : null}
      {variants === null ? (
        <Spinner label="Loading variants" />
      ) : variants.length === 0 ? (
        <p className="form__note">No variants. The product is sold as one item at its own price.</p>
      ) : (
        <div className="table-wrap">
          <table className="table pv-table" aria-label="Variants">
            <thead>
              <tr>
                <th scope="col">Variant</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col" className="num">Price</th>
                <th scope="col">Offer</th>
                <th scope="col">Stock</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v, index) => (
                <tr key={v.id} aria-label={`Variant ${v.label}`}>
                  <td>
                    <span className="cell__primary">{v.label}</span>
                    <span className="cell__secondary">{v.sku ?? 'No SKU'}</span>
                  </td>
                  <td className="num mono">{formatLkr(Number(v.purchase_cost))}</td>
                  <td className="num">
                    {formatLkr(Number(v.selling_price))}
                    <span className="price-source">
                      <Badge tone="muted">{PRICING_SOURCE_LABEL[v.pricing_source] ?? v.pricing_source}</Badge>
                    </span>
                    {v.price_warning ? <span className="cell__secondary field__error">Below cost</span> : null}
                  </td>
                  <td>
                    {v.offer_price != null ? (
                      v.offer_active === false ? (
                        <span className="cell__secondary">Offer ended</span>
                      ) : (
                        <>
                          <Badge tone="offer">{formatMoney(Number(v.offer_price))}</Badge>
                          {v.offer_ends_at ? <span className="cell__secondary">until {formatDay(v.offer_ends_at)}</span> : null}
                        </>
                      )
                    ) : (
                      <span className="cell__secondary">-</span>
                    )}
                  </td>
                  <td>
                    <StockChip stock={v.stock} untracked="Not tracked" />
                  </td>
                  <td>
                    <Badge tone={v.is_active ? 'active' : 'inactive'}>{v.is_active ? 'Active' : 'Inactive'}</Badge>
                    {!v.is_available ? <Badge tone="muted">Unavailable</Badge> : null}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Move ${v.label} up`}
                        disabled={busy || index === 0}
                        onClick={() => void move(index, -1)}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Move ${v.label} down`}
                        disabled={busy || index === variants.length - 1}
                        onClick={() => void move(index, 1)}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Edit ${v.label}`}
                        disabled={busy}
                        onClick={() => setEditing(v)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Delete ${v.label}`}
                        disabled={busy}
                        onClick={() => setPendingDelete(v)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button type="button" className="button button--ghost" disabled={busy || variants === null} onClick={() => setEditing('new')}>
          Add variant
        </button>
      </div>

      {editing ? (
        <VariantDialog
          productId={productId}
          variant={editing === 'new' ? null : editing}
          nextSortOrder={(variants ?? []).reduce((max, v) => Math.max(max, v.sort_order + 1), 0)}
          pricing={pricing}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete variant"
          message={`Delete ${pendingDelete.label}? If it was ever ordered it is archived instead, so past orders keep their history.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------- dialog
interface VariantFormState {
  label: string;
  sku: string;
  barcode: string;
  purchase_cost: string;
  pricing_mode: PricingMode;
  custom_markup_percent: string;
  fixed_selling_price: string;
  offer_price: string;
  offer_ends_on: string;
  is_active: boolean;
  is_available: boolean;
  track_stock: boolean;
  stock_count: string;
  low_stock_threshold: string;
}

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function formFrom(v: StaffVariant | null): VariantFormState {
  if (!v) {
    return {
      label: '',
      sku: '',
      barcode: '',
      purchase_cost: '',
      pricing_mode: 'MARKUP',
      custom_markup_percent: '',
      fixed_selling_price: '',
      offer_price: '',
      offer_ends_on: '',
      is_active: true,
      is_available: true,
      track_stock: false,
      stock_count: '',
      low_stock_threshold: '5',
    };
  }
  return {
    label: v.label,
    sku: v.sku ?? '',
    barcode: v.barcode ?? '',
    purchase_cost: text(v.purchase_cost),
    pricing_mode: v.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP',
    custom_markup_percent: text(v.custom_markup_percent),
    fixed_selling_price: text(v.fixed_selling_price),
    offer_price: text(v.offer_price),
    offer_ends_on: v.offer_ends_at ? colomboDate(v.offer_ends_at) : '',
    is_active: v.is_active,
    is_available: v.is_available,
    track_stock: v.stock?.tracked ?? false,
    stock_count: v.stock?.tracked ? String(v.stock.on_hand) : '',
    low_stock_threshold: String(v.stock?.low_stock_threshold ?? 5),
  };
}

/** Add / edit one variant. */
export function VariantDialog({
  productId,
  variant,
  nextSortOrder,
  pricing,
  onSaved,
  onCancel,
}: {
  productId: string;
  variant: StaffVariant | null;
  nextSortOrder: number;
  pricing: VariantPricingContext;
  /** `close` false: saved, but the dialog stays open (e.g. the stock failed). */
  onSaved(variant: StaffVariant, close?: boolean): void;
  onCancel(): void;
}) {
  const toast = useToast();
  const original = useMemo(() => formFrom(variant), [variant]);
  const [form, setForm] = useState<VariantFormState>(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<VariantFormState>) => setForm((f) => ({ ...f, ...patch }));

  const preview = useMemo<ResolvedVariantPrice | null>(() => {
    const markup = parseMarkupInput(form.custom_markup_percent);
    return resolveVariantPrice({
      purchaseCost: MONEY_INPUT.test(form.purchase_cost.trim()) ? form.purchase_cost.trim() : null,
      pricingMode: form.pricing_mode,
      fixedSellingPrice: form.fixed_selling_price.trim() || null,
      variantMarkupPercent: 'value' in markup ? markup.value : null,
      productMarkupPercent: pricing.productMarkupPercent,
      categoryMarkupPercent: pricing.categoryMarkupPercent,
      parentCategoryMarkupPercent: pricing.parentCategoryMarkupPercent,
      globalMarkupPercent: pricing.globalMarkupPercent,
    });
  }, [form, pricing]);

  const offerText = form.offer_price.trim();
  const storedOfferDay = original.offer_ends_on;
  const offerChanged = offerText !== original.offer_price.trim() || form.offer_ends_on !== storedOfferDay;

  function validate(): boolean {
    const next: Record<string, string> = {};
    const label = form.label.trim();
    if (!label) next.label = 'Enter the variant name, e.g. 100 g or 3 pack';
    else if (label.length > 64) next.label = 'The variant name must be at most 64 characters';
    const sku = form.sku.trim();
    if (sku && (sku.length < 3 || sku.length > 64)) next.sku = 'SKU must be 3 to 64 characters, or leave it blank';
    const cost = form.purchase_cost.trim();
    if (!MONEY_INPUT.test(cost)) next.purchase_cost = 'Enter a valid cost, at most 2 decimals';
    else if (Number(cost) > MAX_PURCHASE_COST) next.purchase_cost = 'Purchase cost can be at most LKR 99,999,999.99';
    if (form.pricing_mode === 'FIXED') {
      const fixed = form.fixed_selling_price.trim();
      if (!fixed) next.fixed_selling_price = 'Enter the selling price for a fixed-price variant';
      else if (!MONEY_INPUT.test(fixed) || Number(fixed) <= 0) next.fixed_selling_price = 'Enter a price above 0 with at most 2 decimals';
      else if (Number(fixed) > MAX_SELLING_PRICE) next.fixed_selling_price = 'Selling price can be at most LKR 99,999,999.99';
    } else {
      const markup = parseMarkupInput(form.custom_markup_percent);
      if ('error' in markup) next.custom_markup_percent = markup.error;
    }
    if (offerText !== '' && offerChanged) {
      if (!MONEY_INPUT.test(offerText) || Number(offerText) <= 0) next.offer_price = 'Enter a price above 0 with at most 2 decimals';
      else if (preview && Number(offerText) >= preview.sellingPrice) {
        next.offer_price = `The offer price must be lower than the selling price (${formatMoney(preview.sellingPrice)}).`;
      }
      if (form.offer_ends_on && form.offer_ends_on !== storedOfferDay && form.offer_ends_on < colomboDate()) {
        next.offer_ends_at = 'Pick today or a later day';
      }
    }
    if (form.track_stock) {
      const count = parseWhole(form.stock_count, { what: 'Stock count' });
      if ('error' in count) next.stock_count = count.error;
    }
    const threshold = parseWhole(form.low_stock_threshold, { what: 'Low-stock level' });
    if ('error' in threshold) next.low_stock_threshold = threshold.error;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /** The fields a PATCH sends: only what changed (a new variant sends everything). */
  function body(isNew: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const changed = (key: keyof VariantFormState) => isNew || form[key] !== original[key];
    if (changed('label')) out.label = form.label.trim();
    if (changed('sku')) out.sku = form.sku.trim() || null;
    if (changed('barcode')) out.barcode = form.barcode.trim() || null;
    if (changed('purchase_cost')) out.purchase_cost = Number(form.purchase_cost.trim());
    if (form.pricing_mode === 'FIXED') {
      if (changed('pricing_mode') || changed('fixed_selling_price')) {
        out.pricing_mode = 'FIXED';
        out.fixed_selling_price = Number(form.fixed_selling_price.trim());
      }
    } else if (changed('pricing_mode') || changed('custom_markup_percent')) {
      out.pricing_mode = 'MARKUP';
      const markup = form.custom_markup_percent.trim();
      out.custom_markup_percent = markup === '' ? null : Number(markup);
    }
    if (isNew ? offerText !== '' : offerChanged) {
      if (offerText === '') {
        out.offer_price = null;
      } else {
        out.offer_price = Number(offerText);
        out.offer_ends_at =
          !isNew && form.offer_ends_on === storedOfferDay
            ? variant?.offer_ends_at ?? null
            : form.offer_ends_on
              ? offerEndOf(form.offer_ends_on)
              : null;
      }
    }
    if (changed('is_active')) out.is_active = form.is_active;
    if (changed('is_available')) out.is_available = form.is_available;
    return out;
  }

  async function submit() {
    setServerError(null);
    if (!validate()) return;
    const count = parseWhole(form.stock_count, { what: 'Stock count' });
    const threshold = parseWhole(form.low_stock_threshold, { what: 'Low-stock level' });
    const countValue = 'value' in count ? count.value : null;
    const thresholdValue = 'value' in threshold ? threshold.value : null;
    setSaving(true);
    try {
      if (!variant) {
        const payload = body(true);
        payload.sort_order = nextSortOrder;
        payload.track_stock = form.track_stock;
        if (form.track_stock && countValue !== null) payload.stock_count = countValue;
        if (thresholdValue !== null) payload.low_stock_threshold = thresholdValue;
        const created = await productsApi.createVariant(productId, payload);
        toast.success(`${created.label} added.`);
        onSaved(created);
        return;
      }
      const patch = body(false);
      let result = variant;
      if (Object.keys(patch).length > 0) result = await productsApi.updateVariant(productId, variant.id, patch);
      // Stock goes through the stock endpoint, only when it changed.
      const stock = variant.stock;
      const stockBody: { variant_id: string; tracked: boolean; stock_count?: number; low_stock_threshold?: number } = {
        variant_id: variant.id,
        tracked: form.track_stock,
      };
      let stockChanged = form.track_stock !== (stock?.tracked ?? false);
      if (form.track_stock && countValue !== null && countValue !== (stock?.tracked ? stock.on_hand : null)) {
        stockBody.stock_count = countValue;
        stockChanged = true;
      }
      if (thresholdValue !== null && thresholdValue !== (stock?.low_stock_threshold ?? 5)) {
        stockBody.low_stock_threshold = thresholdValue;
        stockChanged = true;
      }
      if (stockChanged) {
        try {
          const saved = await inventoryApi.setStock(productId, stockBody);
          result = { ...result, stock: saved.stock };
        } catch (err) {
          // The variant itself is saved (the list shows it); the dialog stays
          // open on the stock error.
          if (result !== variant) onSaved(result, false);
          setServerError(`Stock not saved: ${errorMessage(err, 'Could not set the stock.')}`);
          return;
        }
      }
      toast.success(`${result.label} saved.`);
      onSaved(result);
    } catch (err) {
      const { inline, message } = splitServerErrors(err, VARIANT_FIELDS, 'Could not save the variant.');
      if (Object.keys(inline).length) setErrors(inline);
      // Label / SKU clashes come back as 409s with their own codes.
      const code = (err as { code?: string }).code;
      if (code === 'VARIANT_LABEL_EXISTS') setErrors({ label: message });
      else if (code === 'VARIANT_SKU_EXISTS' || code === 'PRODUCT_SKU_EXISTS') setErrors({ sku: message });
      else if (code === 'OFFER_PRICE_NOT_LOWER') setErrors({ offer_price: message });
      else if (code === 'OFFER_END_IN_PAST') setErrors({ offer_ends_at: message });
      else setServerError(message);
    } finally {
      setSaving(false);
    }
  }

  const title = variant ? `Edit variant ${variant.label}` : 'Add variant';
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        // The dialog sits inside the product form: Enter saves the variant,
        // never the product.
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <div className="modal__panel modal__panel--wide">
        <h2 className="modal__title">{title}</h2>
        <div className="form__row">
          <Field label="Variant name" hint="What customers pick, e.g. 100 g, 3 pack" error={errors.label}>
            <input className="input" value={form.label} onChange={(e) => set({ label: e.target.value })} />
          </Field>
          <Field label="SKU" hint="Optional, its own code" error={errors.sku}>
            <input className="input" value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
          </Field>
        </div>
        <Field label="Barcode" hint="Optional" error={errors.barcode}>
          <input className="input" value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} />
        </Field>

        <div className="pv-dialog__group">
          <p className="pv-dialog__group-title">Price</p>
          <Field label="Purchase cost (LKR)" error={errors.purchase_cost}>
            <input
              className="input"
              inputMode="decimal"
              value={form.purchase_cost}
              onChange={(e) => set({ purchase_cost: e.target.value })}
            />
          </Field>
          <div className="segmented" role="group" aria-label="Variant selling price">
            {PRICING_MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={option.value === form.pricing_mode ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={option.value === form.pricing_mode}
                onClick={() => {
                  if (option.value === 'FIXED' && form.fixed_selling_price.trim() === '' && preview) {
                    set({ pricing_mode: 'FIXED', fixed_selling_price: String(preview.sellingPrice) });
                  } else {
                    set({ pricing_mode: option.value });
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {form.pricing_mode === 'FIXED' ? (
            <Field label="Selling price (LKR)" hint="Customers pay exactly this" error={errors.fixed_selling_price}>
              <input
                className="input"
                inputMode="decimal"
                value={form.fixed_selling_price}
                onChange={(e) => set({ fixed_selling_price: e.target.value })}
              />
            </Field>
          ) : (
            <Field
              label="Variant markup %"
              hint="0 to 999.99. Leave blank to use the product's markup, else the category, parent category or global markup"
              error={errors.custom_markup_percent}
            >
              <input
                className="input"
                inputMode="decimal"
                value={form.custom_markup_percent}
                onChange={(e) => set({ custom_markup_percent: e.target.value })}
              />
            </Field>
          )}
          <VariantPreview preview={preview} mode={form.pricing_mode} />
          <div className="form__row">
            <Field label="Offer price (LKR)" hint="Optional. Customers pay this instead" error={errors.offer_price}>
              <input
                className="input"
                inputMode="decimal"
                value={form.offer_price}
                onChange={(e) => set({ offer_price: e.target.value })}
              />
            </Field>
            <Field label="Offer ends" hint="Optional. Runs to the end of this day" error={errors.offer_ends_at}>
              <input
                className="input"
                type="date"
                value={form.offer_ends_on}
                min={colomboDate()}
                disabled={offerText === ''}
                onChange={(e) => set({ offer_ends_on: e.target.value })}
              />
            </Field>
          </div>
        </div>

        <div className="pv-dialog__group">
          <p className="pv-dialog__group-title">Stock</p>
          <Switch checked={form.track_stock} onChange={(on) => set({ track_stock: on })} label="Track stock">
            Track stock (customers never see the count; they can order until it reaches 0)
          </Switch>
          {form.track_stock ? (
            <div className="form__row">
              <Field
                label="Stock count"
                hint={variant ? 'On hand now. Change it to set a new count' : 'Whole number, optional'}
                error={errors.stock_count}
              >
                <input
                  className="input"
                  inputMode="numeric"
                  value={form.stock_count}
                  onChange={(e) => set({ stock_count: e.target.value })}
                />
              </Field>
              <Field label="Low-stock level" hint={`0 to ${MAX_STOCK.toLocaleString('en-US')}`} error={errors.low_stock_threshold}>
                <input
                  className="input"
                  inputMode="numeric"
                  value={form.low_stock_threshold}
                  onChange={(e) => set({ low_stock_threshold: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <p className="form__note">Not tracked: never limited, sourced on order.</p>
          )}
          {variant?.stock?.tracked ? <StockFigures stock={variant.stock} /> : null}
        </div>

        <div className="pv-dialog__group pv-switches">
          <Switch checked={form.is_active} onChange={(on) => set({ is_active: on })} label="Active">
            Active (inactive variants are hidden from customers)
          </Switch>
          <Switch checked={form.is_available} onChange={(on) => set({ is_available: on })} label="Available">
            Available (unavailable variants show but cannot be ordered)
          </Switch>
        </div>

        {serverError ? (
          <p className="field__error" role="alert">
            {serverError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button" disabled={saving} onClick={() => void submit()}>
            {saving ? <Spinner label="Saving" /> : variant ? 'Save variant' : 'Add variant'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VariantPreview({ preview, mode }: { preview: ResolvedVariantPrice | null; mode: PricingMode }) {
  if (!preview) {
    return (
      <p className="form__note" role="status">
        {mode === 'FIXED' ? 'Enter the purchase cost and the selling price to see the margin.' : 'Enter the purchase cost to see the selling price.'}
      </p>
    );
  }
  if (preview.pricingMode === 'FIXED') {
    const m = preview.effectiveMarkupPercent;
    return (
      <>
        <p className="form__note" role="status">
          Selling price {formatLkr(preview.sellingPrice)}
          {m === null ? '' : m < 0 ? ` (${formatPercent(-m)}% below cost)` : ` (${formatPercent(m)}% over cost)`}
        </p>
        {preview.lossPerUnit !== null ? (
          <p className="field__error" role="alert">
            Below purchase cost — you lose {formatLkr(preview.lossPerUnit)} per unit. You can still save it.
          </p>
        ) : null}
      </>
    );
  }
  return (
    <p className="form__note" role="status">
      Selling price {formatLkr(preview.sellingPrice)} ({variantSourceText(preview.pricingSource, preview.effectiveMarkupPercent)})
    </p>
  );
}

/** On hand / in open orders / sellable, with the Low or Sold out badge. */
export function StockFigures({ stock }: { stock: StaffStock }) {
  return (
    <dl className="pv-figures" aria-label="Current stock">
      <div>
        <dt>On hand</dt>
        <dd className="mono">{stock.on_hand}</dd>
      </div>
      <div>
        <dt>In open orders</dt>
        <dd className="mono">{stock.in_open_orders}</dd>
      </div>
      <div>
        <dt>Sellable</dt>
        <dd className="mono">{stock.sellable ?? '-'}</dd>
      </div>
      {stock.is_out_of_stock ? (
        <span className="pv-chip pv-chip--out">Sold out</span>
      ) : stock.is_low_stock ? (
        <span className="pv-chip pv-chip--low">Low</span>
      ) : null}
    </dl>
  );
}
