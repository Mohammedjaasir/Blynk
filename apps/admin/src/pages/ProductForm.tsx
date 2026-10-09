import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { categories as categoriesApi, products as productsApi } from '../api/resources';
import type { Category } from '../api/types';
import { ImageUploader } from '../components/ImageUploader';
import { PageHeader } from '../components/Layout';
import { ApiError } from '../api/client';
import { Field, Spinner, useToast } from '../components/ui';
import { errorMessage, splitServerErrors } from '../lib/apiErrors';
import { colomboDate, formatDay } from '../lib/coupons';
import { useImageCleanup } from '../lib/imageCleanup';
import { formatMoney } from '../lib/orders';

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
  'offer_price',
  'offer_ends_at',
] as const;

/**
 * Offer end (owner, 2026-10-09): the owner picks a day and the offer runs to
 * the end of that day in Colombo.
 */
export const offerEndOf = (date: string) => `${date}T23:59:59+05:30`;

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
  custom_markup_percent: string;
  /** Offer price (owner, 2026-10-09); blank = no offer. */
  offer_price: string;
  /** YYYY-MM-DD in Colombo; blank = no end date. */
  offer_ends_on: string;
  is_available: boolean;
  is_active: boolean;
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
  custom_markup_percent: '',
  offer_price: '',
  offer_ends_on: '',
  is_available: true,
  is_active: true,
};

/**
 * Add / edit a product against the existing backend product schema. No
 * field here is invented: purchase cost and markup are the backend's own
 * pricing inputs, and the selling price stays a backend calculation - this
 * form only previews it.
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
  const [effectiveMarkup, setEffectiveMarkup] = useState<number | null>(null);
  // The saved selling price, for the offer check while the preview can't
  // compute one.
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const [storedOffer, setStoredOffer] = useState<StoredOffer>({ price: null, endsAt: null });
  // The image the saved product points at; replaced files are deleted only
  // after a successful save.
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const images = useImageCleanup([originalImage]);

  useEffect(() => {
    void categoriesApi
      .listAdmin()
      .then((rows) => {
        setCategories(rows);
        setForm((current) =>
          current.category_id || rows.length === 0
            ? current
            : { ...current, category_id: rows[0]!.id }
        );
      })
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void productsApi
      .getAdmin(id)
      .then((product) => {
        if (cancelled) return;
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
          custom_markup_percent:
            product.custom_markup_percent === null ||
            product.custom_markup_percent === undefined
              ? ''
              : String(product.custom_markup_percent),
          offer_price:
            product.offer_price === null || product.offer_price === undefined
              ? ''
              : String(product.offer_price),
          offer_ends_on: product.offer_ends_at ? colomboDate(product.offer_ends_at) : '',
          is_available: product.is_available,
          is_active: product.is_active,
        });
        setEffectiveMarkup(product.effective_markup_percent ?? null);
        setSavedPrice(product.calculated_selling_price ?? null);
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

  /**
   * Preview only. The backend recomputes this from purchase cost and the
   * effective markup (custom, else the category/global default), and its
   * value is the one customers see.
   */
  const previewPrice = useMemo(() => {
    const cost = Number(form.purchase_cost);
    const markup =
      form.custom_markup_percent.trim() !== ''
        ? Number(form.custom_markup_percent)
        : effectiveMarkup;
    if (!Number.isFinite(cost) || markup === null || !Number.isFinite(markup)) {
      return null;
    }
    return cost * (1 + markup / 100);
  }, [form.purchase_cost, form.custom_markup_percent, effectiveMarkup]);

  /** The selling price the offer must beat: the preview, else the saved one. */
  const sellingPrice = useMemo(() => {
    const price = previewPrice ?? savedPrice;
    return price === null ? null : Math.round(price * 100) / 100;
  }, [previewPrice, savedPrice]);

  const storedOfferDay = storedOffer.endsAt ? colomboDate(storedOffer.endsAt) : '';
  const offerChanged =
    (form.offer_price.trim() === '' ? null : Number(form.offer_price)) !== storedOffer.price ||
    form.offer_ends_on !== storedOfferDay;
  /** The stored offer's end has passed. */
  const storedOfferEnded =
    storedOffer.price !== null &&
    storedOffer.endsAt !== null &&
    Date.parse(storedOffer.endsAt) <= Date.now();

  /** "12% off - customers pay LKR 220 instead of LKR 250", while valid. */
  const offerSummary = useMemo(() => {
    const offer = Number(form.offer_price);
    if (form.offer_price.trim() === '' || !Number.isFinite(offer) || offer <= 0) return null;
    if (sellingPrice === null || offer >= sellingPrice) return null;
    const percent = Math.round((1 - offer / sellingPrice) * 100);
    return `${percent}% off - customers pay ${formatMoney(offer)} instead of ${formatMoney(sellingPrice)}`;
  }, [form.offer_price, sellingPrice]);

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
    if (form.custom_markup_percent.trim() !== '') {
      const markup = Number(form.custom_markup_percent);
      if (!Number.isFinite(markup) || markup < 0 || markup > MAX_MARKUP_PERCENT) {
        next.custom_markup_percent = 'Markup must be between 0 and 999.99';
      }
    }
    // Offer (owner, 2026-10-09). An ended offer left untouched is not
    // re-checked: it is not sent, and the backend keeps it as stored.
    if (form.offer_price.trim() !== '' && (offerChanged || !storedOfferEnded)) {
      const offer = Number(form.offer_price);
      if (!Number.isFinite(offer) || offer <= 0 || !/^\d+(\.\d{1,2})?$/.test(form.offer_price.trim())) {
        next.offer_price = 'Enter a price above 0 with at most 2 decimals';
      } else if (sellingPrice !== null && offer >= sellingPrice) {
        next.offer_price = `The offer price must be lower than the selling price (${formatMoney(sellingPrice)}).`;
      }
      if (form.offer_ends_on && form.offer_ends_on !== storedOfferDay && form.offer_ends_on < colomboDate()) {
        next.offer_ends_at = 'Pick today or a later day';
      } else if (storedOfferEnded && form.offer_ends_on && form.offer_ends_on === storedOfferDay) {
        next.offer_ends_at = 'This offer has ended. Pick a new end day or clear it.';
      }
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
      purchase_cost: Number(form.purchase_cost),
      custom_markup_percent:
        form.custom_markup_percent.trim() === ''
          ? null
          : Number(form.custom_markup_percent),
      is_available: form.is_available,
      is_active: form.is_active,
    };
    // Offer fields go only when they changed (owner, 2026-10-09): a cleared
    // price removes the offer (the backend clears its end too), and an
    // unchanged end is resent exactly as stored.
    if (offerChanged) {
      if (form.offer_price.trim() === '') {
        if (storedOffer.price !== null) payload.offer_price = null;
      } else {
        payload.offer_price = Number(form.offer_price);
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
      if (isEditing && id) {
        await productsApi.update(id, payload);
        toast.success('Product updated.');
      } else {
        await productsApi.create(payload);
        toast.success('Product created.');
      }
      // Saved: the image it no longer uses (removed or replaced) can go now.
      await images.afterSave([form.image_url]);
      navigate('/products');
    } catch (err) {
      // The offer refusals carry their own codes; show them by their field.
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
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
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

        <section className="form__section">
          <h2 className="form__section-title">Pricing</h2>
          <div className="form__row">
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
            <Field
              label="Custom markup %"
              hint="0 to 999.99. Leave blank to use the category/global markup"
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
          </div>
          <p className="form__note">
            {previewPrice === null
              ? 'Selling price is calculated by the backend when you save.'
              : `Preview selling price: LKR ${previewPrice.toFixed(2)} (the backend recalculates on save).`}
          </p>
        </section>

        <section className="form__section" aria-label="Offer">
          <h2 className="form__section-title">Offer</h2>
          <div className="form__row">
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
                disabled={form.offer_price.trim() === ''}
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
          ) : form.offer_price.trim() !== '' && sellingPrice === null ? (
            <p className="form__note">The offer price must be lower than the selling price calculated on save.</p>
          ) : null}
          {form.offer_price.trim() === '' && storedOffer.price !== null ? (
            <p className="form__note">The offer is removed when you save.</p>
          ) : null}
          {form.offer_price.trim() !== '' ? (
            <div>
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setForm({ ...form, offer_price: '', offer_ends_on: '' })}
              >
                Remove offer
              </button>
            </div>
          ) : null}
        </section>

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
