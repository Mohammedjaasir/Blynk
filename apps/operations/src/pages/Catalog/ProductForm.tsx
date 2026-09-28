import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { catalog } from '../../api/resources';
import type { Category } from '../../api/types';
import { CENTRE_FOCAL, ImageUploader, type FocalPoint } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { Field, Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';

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
  custom_markup_percent: string;
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
  // The centre, which is precisely what a `cover` crop already did.
  image_focal: CENTRE_FOCAL,
  purchase_cost: '',
  custom_markup_percent: '',
  is_available: true,
  is_active: true,
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
  const [effectiveMarkup, setEffectiveMarkup] = useState<number | null>(null);

  useEffect(() => {
    void catalog.categories
      .list()
      .then((rows) => {
        setCategories(rows);
        setForm((current) => (current.category_id || rows.length === 0 ? current : { ...current, category_id: rows[0]!.id }));
      })
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void catalog.products
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
          // An API response from before 009 carries no focal point at all;
          // the centre is both the default and the behaviour it already had.
          image_focal: {
            x: product.image_focal_x ?? 50,
            y: product.image_focal_y ?? 50,
          },
          purchase_cost: String(product.purchase_cost ?? ''),
          custom_markup_percent:
            product.custom_markup_percent === null || product.custom_markup_percent === undefined
              ? ''
              : String(product.custom_markup_percent),
          is_available: product.is_available,
          is_active: product.is_active,
        });
        setEffectiveMarkup(product.effective_markup_percent ?? null);
      })
      .catch((err) => setServerError(catalogErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** Preview only. The backend recomputes this from purchase cost and the
   * effective markup (custom, else the category/global default), and its
   * value is the one customers see. */
  const previewPrice = useMemo(() => {
    const cost = Number(form.purchase_cost);
    const markup = form.custom_markup_percent.trim() !== '' ? Number(form.custom_markup_percent) : effectiveMarkup;
    if (!Number.isFinite(cost) || markup === null || !Number.isFinite(markup)) return null;
    return cost * (1 + markup / 100);
  }, [form.purchase_cost, form.custom_markup_percent, effectiveMarkup]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.category_id) next.category_id = 'Choose a category';
    if (form.name.trim().length < 2) next.name = 'Enter the product name';
    if (form.sku.trim().length < 3) next.sku = 'SKU must be at least 3 characters';
    if (form.unit.trim().length < 1) next.unit = 'Enter the unit, e.g. 1 L';
    const cost = Number(form.purchase_cost);
    if (!Number.isFinite(cost) || cost < 0) next.purchase_cost = 'Enter a valid cost';
    if (form.custom_markup_percent.trim() !== '') {
      const markup = Number(form.custom_markup_percent);
      if (!Number.isFinite(markup) || markup < 0 || markup > 1000) next.custom_markup_percent = 'Markup must be between 0 and 1000';
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
      custom_markup_percent: form.custom_markup_percent.trim() === '' ? null : Number(form.custom_markup_percent),
      is_available: form.is_available,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (isEditing && id) {
        await catalog.products.update(id, payload);
      } else {
        await catalog.products.create(payload);
      }
      navigate('/catalog/products');
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

        <section className="form__section">
          <h2 className="form__section-title">Pricing</h2>
          <div className="form__row">
            <Field label="Purchase cost (LKR)" error={errors.purchase_cost}>
              <input className="input" inputMode="decimal" value={form.purchase_cost} onChange={(event) => setForm({ ...form, purchase_cost: event.target.value })} />
            </Field>
            <Field label="Custom markup %" hint="Leave blank to use the category/global markup" error={errors.custom_markup_percent}>
              <input
                className="input"
                inputMode="decimal"
                value={form.custom_markup_percent}
                onChange={(event) => setForm({ ...form, custom_markup_percent: event.target.value })}
              />
            </Field>
          </div>
          <p className="form__note">
            {previewPrice === null
              ? 'Selling price is calculated by the backend when you save.'
              : `Preview selling price: LKR ${previewPrice.toFixed(2)} (the backend recalculates on save).`}
          </p>
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
