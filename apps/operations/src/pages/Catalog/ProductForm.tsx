import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteImagesQuietly } from '../../api/client';
import { catalog, settings } from '../../api/resources';
import type { Category, PricingMode } from '../../api/types';
import { CENTRE_FOCAL, ImageUploader, type FocalPoint } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { Field, Spinner } from '../../components/ui';
import {
  catalogErrorMessage,
  colomboDay,
  colomboTodayDay,
  formatColomboDate,
  offerEndForDay,
  parseOfferAmountOff,
  parseOfferPrice,
  percentOff,
} from '../../lib/catalog';
import { replacedImages } from '../../lib/image';
import {
  FALLBACK_DEFAULT_MARKUP_PERCENT,
  belowCostText,
  inheritedMarkup,
  marginPercent,
  markupPrice,
  markupSourceText,
  parseMarkupPercent,
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
  is_available: boolean;
  is_active: boolean;
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
}

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
  pricing_mode: 'MARKUP',
  custom_markup_percent: '',
  fixed_selling_price: '',
  is_available: true,
  is_active: true,
  offer_price: '',
  offer_end_day: '',
  offer_mode: 'price',
  offer_off: '',
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
  const [savedOffer, setSavedOffer] = useState<SavedOffer>(NO_OFFER);

  useEffect(() => {
    void catalog.categories
      .list()
      .then((rows) => {
        setCategories(rows);
        setForm((current) => (current.category_id || rows.length === 0 ? current : { ...current, category_id: rows[0]!.id }));
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
        const offer: SavedOffer = {
          price: product.offer_price === null || product.offer_price === undefined ? '' : String(product.offer_price),
          // Shown back as the day it ends on in Colombo, whatever time it was stored at.
          endDay: product.offer_ends_at ? colomboDay(product.offer_ends_at) : '',
          endsAt: product.offer_ends_at ?? null,
          active: product.offer_active === true,
        };
        setSavedOffer(offer);
        setSavedSellingPrice(
          product.calculated_selling_price === undefined ? null : Number(product.calculated_selling_price)
        );
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
          purchase_cost: String(product.purchase_cost ?? ''),
          pricing_mode: product.pricing_mode === 'FIXED' ? 'FIXED' : 'MARKUP',
          custom_markup_percent:
            product.custom_markup_percent === null || product.custom_markup_percent === undefined
              ? ''
              : String(product.custom_markup_percent),
          fixed_selling_price:
            product.fixed_selling_price === null || product.fixed_selling_price === undefined
              ? ''
              : String(product.fixed_selling_price),
          is_available: product.is_available,
          is_active: product.is_active,
          // A stored offer opens as its price; "LKR off" shows the same
          // offer as an amount off the current selling price.
          offer_price: offer.price,
          offer_end_day: offer.endDay,
          offer_mode: 'price',
          offer_off: '',
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

  /** The purchase cost as typed, or null when it is not a valid amount yet. */
  const cost = useMemo(() => {
    const s = form.purchase_cost.trim();
    const n = Number(s);
    return s !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  }, [form.purchase_cost]);

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
    if (cost === null) return null;
    const custom = parseMarkupPercent(form.custom_markup_percent);
    if ('error' in custom) return null;
    const markup = resolveMarkup(custom.value, inherited);
    return { price: markupPrice(cost, markup.percent), markup };
  }, [form.pricing_mode, form.fixed_selling_price, form.custom_markup_percent, cost, inherited]);
  const previewPrice = preview?.price ?? null;
  const margin = previewPrice !== null && cost !== null ? marginPercent(cost, previewPrice) : null;
  const belowCost = previewPrice !== null && cost !== null ? belowCostText(cost, previewPrice) : null;

  /** The selling price the offer is measured against: the preview above, else
   * the saved product's own price. */
  const sellingForOffer = previewPrice ?? savedSellingPrice;

  /** What the operator typed in the active offer field; '' = no offer. */
  const offerText = (form.offer_mode === 'off' ? form.offer_off : form.offer_price).trim();
  const offerParsed =
    offerText === ''
      ? null
      : form.offer_mode === 'off'
        ? parseOfferAmountOff(form.offer_off, sellingForOffer)
        : parseOfferPrice(form.offer_price, sellingForOffer);
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

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.category_id) next.category_id = 'Choose a category';
    if (form.name.trim().length < 2) next.name = 'Enter the product name';
    if (form.sku.trim().length < 3) next.sku = 'SKU must be at least 3 characters';
    if (form.unit.trim().length < 1) next.unit = 'Enter the unit, e.g. 1 L';
    const costValue = Number(form.purchase_cost);
    if (!Number.isFinite(costValue) || costValue < 0) next.purchase_cost = 'Enter a valid cost';
    if (form.pricing_mode === 'FIXED') {
      const fixed = parseSellingPrice(form.fixed_selling_price);
      if ('error' in fixed) next.fixed_selling_price = fixed.error;
    } else {
      const markup = parseMarkupPercent(form.custom_markup_percent);
      if ('error' in markup) next.custom_markup_percent = markup.error;
    }
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
      purchase_cost: Number(form.purchase_cost),
      pricing_mode: form.pricing_mode,
      is_available: form.is_available,
      is_active: form.is_active,
    };
    // Only the active mode's own field goes (backend contract): Markup sends
    // its custom markup (null = inherit), Fixed sends its price. The other
    // stays stored on the server, ignored while unused.
    if (form.pricing_mode === 'FIXED') {
      payload.fixed_selling_price = Number(form.fixed_selling_price.trim());
    } else {
      const markup = parseMarkupPercent(form.custom_markup_percent);
      payload.custom_markup_percent = 'value' in markup ? markup.value : null;
    }
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
      // A fixed price below cost saves (owner rule), and the list says so.
      const warning = saved?.price_warning?.message;
      navigate('/catalog/products', warning ? { state: { notice: `${form.name.trim()} saved. ${warning}` } } : undefined);
    } catch (err) {
      setServerError(catalogErrorMessage(err));
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
          <Field label="Purchase cost (LKR)" error={errors.purchase_cost}>
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
                  : 'Enter the purchase cost to see the selling price.'}
              </p>
            </>
          )}
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
        </section>

        <section className="form__section">
          <h2 className="form__section-title">Availability</h2>
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
    </div>
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
