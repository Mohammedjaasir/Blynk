import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { sellerApi } from '../api/resources';
import type { Category, ProductInput, SellerProduct } from '../api/types';
import { useSeller } from '../auth/SellerContext';
import { ImagePicker } from '../components/ImagePicker';
import { IconArrowLeft } from '../components/icons';
import { ButtonArrow, Field, describedBy, ErrorState, Eyebrow, PageLoading } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import { formatDate, lkr, parsePrice } from '../lib/format';
import { groupCategories } from '../lib/products';

const UNIT_SUGGESTIONS = ['1 kg', '500 g', '250 g', '1 L', '500 ml', '1 piece', '1 pack', '1 dozen', '1 bottle'];
export const MAX_PRICE = 1_000_000;

interface FormState {
  name: string;
  category_id: string;
  unit: string;
  pack_size: string;
  description: string;
  barcode: string;
  price: string;
  image_url: string | null;
}

const EMPTY: FormState = {
  name: '',
  category_id: '',
  unit: '',
  pack_size: '',
  description: '',
  barcode: '',
  price: '',
  image_url: null,
};

type Errors = Partial<Record<keyof FormState, string>>;

/** The form values a product starts with: its waiting change if there is one, else the live values. */
function fromProduct(product: SellerProduct): FormState {
  const waiting = product.pending;
  const payload = waiting?.payload;
  // A field the waiting change does not mention keeps the live value.
  const pick = <T,>(waitingValue: T | undefined, liveValue: T): T => (waitingValue === undefined ? liveValue : waitingValue);
  return {
    name: pick(payload?.name, product.name),
    category_id: pick(payload?.category_id, product.category_id) ?? '',
    unit: pick(payload?.unit, product.unit) ?? '',
    pack_size: pick(payload?.pack_size, product.pack_size) ?? '',
    description: pick(payload?.description, product.description) ?? '',
    barcode: pick(payload?.barcode, product.barcode) ?? '',
    price: String(waiting ? waiting.seller_price : product.seller_price),
    image_url: pick(payload?.image_url, product.image_url) ?? null,
  };
}

/** The values the live product has right now (what an edit is compared with). */
function liveValues(product: SellerProduct): FormState {
  return fromProduct({ ...product, pending: null });
}

export const PHOTO_REQUIRED_MESSAGE = 'Add a photo of your product.';

/**
 * `photoRequired`: a new product needs a photo (the API refuses one without: IMAGE_REQUIRED). An
 * edit keeps the photo the product already has, so the photo cannot be taken away by an edit.
 */
function validate(form: FormState, photoRequired: boolean): Errors {
  const errors: Errors = {};
  const name = form.name.trim();
  if (name.length < 2) errors.name = 'Enter the product name (at least 2 letters).';
  else if (name.length > 120) errors.name = 'The name is too long (120 letters at most).';
  if (!form.category_id) errors.category_id = 'Choose a category.';
  if (!form.unit.trim()) errors.unit = 'Enter the unit, for example 1 kg or 500 ml.';
  else if (form.unit.trim().length > 32) errors.unit = 'The unit is too long (32 letters at most).';
  if (form.pack_size.trim().length > 64) errors.pack_size = 'The pack size is too long (64 letters at most).';
  if (form.description.trim().length > 2000) errors.description = 'The description is too long (2000 letters at most).';
  if (form.barcode.trim().length > 64) errors.barcode = 'The barcode is too long (64 characters at most).';
  if (photoRequired && !form.image_url) errors.image_url = PHOTO_REQUIRED_MESSAGE;
  const price = parsePrice(form.price);
  if (!form.price.trim()) errors.price = 'Enter the price you want for this product.';
  else if (price === null) errors.price = 'Enter the price as a number, for example 250 or 250.50.';
  else if (price <= 0) errors.price = 'The price must be more than 0.';
  else if (price > MAX_PRICE) errors.price = 'The price cannot be more than LKR 1,000,000.';
  return errors;
}

/** Server field names -> this form's field names. */
const SERVER_FIELD: Record<string, keyof FormState> = {
  name: 'name',
  category_id: 'category_id',
  unit: 'unit',
  pack_size: 'pack_size',
  description: 'description',
  barcode: 'barcode',
  seller_price: 'price',
  image_url: 'image_url',
};

/** Add a product, or (with :id) ask for a change to one. Both go to Blynk for approval. */
export function ProductForm({ mode }: { mode: 'new' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { canSell, seller } = useSeller();

  const prefill = (location.state as { prefill?: SellerProduct } | null)?.prefill ?? null;

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [product, setProduct] = useState<SellerProduct | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => (prefill ? fromProduct({ ...prefill, pending: null }) : EMPTY));
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Categories, plus (when editing) the product itself: there is no single-product route,
  // so the product comes from the list.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError(null);
      try {
        const [cats, products] = await Promise.all([
          sellerApi.categories(),
          mode === 'edit' ? sellerApi.products() : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setCategories(cats);
        if (mode === 'edit') {
          const found = products?.find((p) => p.id === id) ?? null;
          if (!found) {
            setLoadError('We could not find that product.');
            return;
          }
          setProduct(found);
          const start = fromProduct(found);
          setForm(start);
          setInitial(start);
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err, 'Could not load this page. Please try again.'));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, id, attempt]);

  const groups = useMemo(() => groupCategories(categories ?? []), [categories]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = validate(form, photoRequired);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError('Please fix the highlighted boxes.');
      return;
    }
    const price = parsePrice(form.price)!;
    const values: ProductInput = {
      name: form.name.trim(),
      category_id: form.category_id,
      unit: form.unit.trim(),
      pack_size: form.pack_size.trim() || null,
      description: form.description.trim() || null,
      barcode: form.barcode.trim() || null,
      image_url: form.image_url,
      seller_price: price,
    };

    setSaving(true);
    try {
      if (mode === 'new') {
        await sellerApi.addProduct(values);
        navigate('/products', {
          state: {
            notice: `Thank you! Blynk will check "${values.name}" and set the price customers pay. You will see it here as "Waiting for approval".`,
          },
        });
      } else if (product) {
        const diff = changedFields(values, liveValues(product));
        if (Object.keys(diff).length === 0) {
          setFormError('This is the same as your live product, so there is nothing to send to Blynk.');
          return;
        }
        await sellerApi.editProduct(product.id, diff);
        navigate('/products', {
          state: {
            notice: `Your change to "${values.name}" was sent to Blynk. The live product stays as it is until Blynk approves it.`,
          },
        });
      }
    } catch (err) {
      const server = fieldErrors(err);
      const mapped: Errors = {};
      if (err instanceof ApiError && err.code === 'IMAGE_REQUIRED') mapped.image_url = PHOTO_REQUIRED_MESSAGE;
      for (const [field, message] of Object.entries(server)) {
        const key = SERVER_FIELD[field];
        if (key) mapped[key] = message;
      }
      if (Object.keys(mapped).length > 0) setErrors((e) => ({ ...e, ...mapped }));
      setFormError(
        Object.keys(mapped).length > 0
          ? 'Please fix the highlighted boxes.'
          : errorMessage(err, 'Could not send this to Blynk. Please try again.')
      );
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'new' ? 'Add a product' : 'Edit product';
  // A new product needs a photo; an edit of a product that has one keeps one.
  const photoRequired = mode === 'new' || Boolean(initial.image_url);
  const dirty = mode === 'new' ? true : JSON.stringify(form) !== JSON.stringify(initial);

  if (loadError) {
    return (
      <section>
        <h1>{title}</h1>
        <ErrorState message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
        <p>
          <Link to="/products">Back to my products</Link>
        </p>
      </section>
    );
  }

  if (!canSell) {
    return (
      <section>
        <h1>{title}</h1>
        <p className="notice notice--wait" role="status">
          {seller?.status === 'SUSPENDED'
            ? 'Your shop is switched off, so you cannot add or change products.'
            : 'You can add and change products once Blynk has approved your shop.'}
        </p>
        <Link to="/products" className="button button--ghost">
          Back to my products
        </Link>
      </section>
    );
  }

  if (categories === null || (mode === 'edit' && !product)) {
    return (
      <section>
        <h1>{title}</h1>
        <PageLoading label="Loading" />
      </section>
    );
  }

  return (
    <section aria-labelledby="form-title">
      <Link to="/products" className="back-link">
        <IconArrowLeft size={18} /> My products
      </Link>
      <div className="page__head page__head--form">
        <div className="page__titles">
          <Eyebrow>{mode === 'new' ? 'New product' : 'Change request'}</Eyebrow>
          <h1 id="form-title">{title}</h1>
        </div>
      </div>

      {mode === 'edit' && product ? (
        <div className="notice notice--wait" role="note">
          <p>
            <strong>The live product stays exactly as it is until Blynk approves your change.</strong> Customers keep
            seeing the old name, photo and price until then.
          </p>
          {product.pending ? (
            <p>
              You already have a change waiting (sent {formatDate(product.pending.created_at)}). Sending this replaces
              it.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="notice notice--info" role="note">
          <p>
            Blynk checks every product before it goes live, and Blynk sets the price customers pay. The price you enter
            below is what you receive for each one sold.
            {mode === 'edit' ? '' : ' You will see the product as "Waiting for approval" until then.'}
          </p>
        </div>
      )}

      <form onSubmit={submit} noValidate className="pform">
        <div className="pform__grid">
          <div className="panel pform__details">
            <h2 className="panel__title">Product details</h2>
            <Field id="p-name" label="Product name" required error={errors.name}>
              <input
                id="p-name"
                type="text"
                autoComplete="off"
                maxLength={120}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={describedBy('p-name', false, errors.name)}
              />
            </Field>

            <Field id="p-category" label="Category" required error={errors.category_id}>
              <select
                id="p-category"
                value={form.category_id}
                onChange={(e) => set('category_id', e.target.value)}
                aria-invalid={Boolean(errors.category_id)}
                aria-describedby={describedBy('p-category', false, errors.category_id)}
              >
                <option value="">Choose a category</option>
                {groups.map(({ main, children }) =>
                  children.length > 0 ? (
                    <optgroup key={main.id} label={main.name}>
                      {children.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={main.id} value={main.id}>
                      {main.name}
                    </option>
                  )
                )}
              </select>
            </Field>

            <div className="form__row">
              <Field id="p-unit" label="Unit" required error={errors.unit} hint="How it is sold, for example 1 kg or 500 ml.">
                <input
                  id="p-unit"
                  type="text"
                  list="unit-suggestions"
                  autoComplete="off"
                  maxLength={32}
                  value={form.unit}
                  onChange={(e) => set('unit', e.target.value)}
                  aria-invalid={Boolean(errors.unit)}
                  aria-describedby={describedBy('p-unit', true, errors.unit)}
                />
                <datalist id="unit-suggestions">
                  {UNIT_SUGGESTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </Field>
              <Field id="p-pack" label="Pack size" error={errors.pack_size} hint="For example pack of 6.">
                <input
                  id="p-pack"
                  type="text"
                  autoComplete="off"
                  maxLength={64}
                  value={form.pack_size}
                  onChange={(e) => set('pack_size', e.target.value)}
                  aria-invalid={Boolean(errors.pack_size)}
                  aria-describedby={describedBy('p-pack', true, errors.pack_size)}
                />
              </Field>
            </div>

            <Field id="p-desc" label="Description" error={errors.description} hint="What it is, what is in it, how fresh it is.">
              <textarea
                id="p-desc"
                rows={4}
                maxLength={2000}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={describedBy('p-desc', true, errors.description)}
              />
            </Field>

            <Field id="p-barcode" label="Barcode" error={errors.barcode} hint="The number under the barcode on the pack, if it has one.">
              <input
                id="p-barcode"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={64}
                value={form.barcode}
                onChange={(e) => set('barcode', e.target.value)}
                aria-invalid={Boolean(errors.barcode)}
                aria-describedby={describedBy('p-barcode', true, errors.barcode)}
              />
            </Field>
          </div>

          <div className="pform__side">
            <div className="panel">
              <h2 className="panel__title" id="p-photo-label">
                Photo{' '}
                {photoRequired ? (
                  <span className="field__req">(required)</span>
                ) : (
                  <span className="field__opt">(optional)</span>
                )}
              </h2>
              <ImagePicker value={form.image_url} onChange={(url) => set('image_url', url)} onBusyChange={setUploading} />
              {errors.image_url ? (
                <p className="field__error" role="alert">
                  {errors.image_url}
                </p>
              ) : null}
            </div>

            <div className="panel panel--price">
              <h2 className="panel__title">Price</h2>
              <Field
                id="p-price"
                label="Your price (LKR)"
                required
                error={errors.price}
                hint="What you want to receive for each one sold. Blynk sets the price customers pay."
              >
                <div className="input-affix input-affix--text">
                  <span className="input-affix__prefix" aria-hidden="true">
                    LKR
                  </span>
                  <input
                    id="p-price"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="250.00"
                    value={form.price}
                    onChange={(e) => set('price', e.target.value)}
                    aria-invalid={Boolean(errors.price)}
                    aria-describedby={describedBy('p-price', true, errors.price)}
                  />
                </div>
              </Field>
              {mode === 'edit' && product && product.live && product.selling_price !== null ? (
                <p className="muted price-now">Customers currently pay {lkr(product.selling_price)}.</p>
              ) : null}
            </div>
          </div>
        </div>

        {formError ? (
          <p className="notice notice--bad" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="form__actions">
          <button type="submit" className="button button--primary button--cta" disabled={saving || uploading || !dirty}>
            {saving
              ? 'Sending...'
              : mode === 'new'
                ? 'Send to Blynk for approval'
                : 'Send change to Blynk for approval'}
            {saving ? null : <ButtonArrow />}
          </button>
          <Link to="/products" className="button button--ghost">
            Cancel
          </Link>
        </div>
        {uploading ? <p className="muted">Uploading the photo... please wait a moment.</p> : null}
      </form>
    </section>
  );
}

/** Only the fields that differ from the live product are sent (the API keeps the rest). */
function changedFields(values: ProductInput, live: FormState): Partial<ProductInput> {
  const diff: Partial<ProductInput> = {};
  if (values.name !== live.name.trim()) diff.name = values.name;
  if (values.category_id !== live.category_id) diff.category_id = values.category_id;
  if (values.unit !== live.unit.trim()) diff.unit = values.unit;
  if ((values.pack_size ?? '') !== live.pack_size.trim()) diff.pack_size = values.pack_size;
  if ((values.description ?? '') !== live.description.trim()) diff.description = values.description;
  if ((values.barcode ?? '') !== live.barcode.trim()) diff.barcode = values.barcode;
  if ((values.image_url ?? null) !== (live.image_url ?? null)) diff.image_url = values.image_url;
  if (values.seller_price !== parsePrice(live.price)) diff.seller_price = values.seller_price;
  return diff;
}
