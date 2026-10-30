import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { catalog } from '../../api/resources';
import { sellers as sellersApi } from '../../api/sellers';
import type { Category } from '../../api/types';
import { ImageUploader } from '../../components/ImageUploader';
import { Status, type Tone } from '../../components/ui';
import { categoryOptions } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { lkr, notReady, type AdminSeller } from '../../lib/sellers';
import {
  EMPTY_SHOP_PRODUCT,
  PRODUCT_STATUS_HELP,
  PRODUCT_STATUS_LABEL,
  belowSellerPriceNote,
  newShopProductBody,
  productCountsText,
  type NewShopProductForm,
  type SellerProductStatus,
  type SellerShopProduct,
  type ShopProductField,
} from '../../lib/sellerShop';
import { Sheet, TextField, type Loaded } from './parts';
import './sellers.css';

const TONE: Record<SellerProductStatus, Tone> = { LIVE: 'ok', PAUSED: 'warn', OFF: 'muted' };

/**
 * Seller detail -> Products (2026-10-30): what this seller sells (photo, name, category, the seller's
 * price, the customer price, a LIVE / PAUSED / OFF chip and stock), and for an APPROVED seller an
 * "Add product" sheet so staff can list a product for a seller who does not know how. The product is
 * created live and owned by the seller (POST /admin/sellers/:id/products).
 */
export function SellerShopProducts({ seller, onAdded, onNotify }: { seller: AdminSeller; onAdded(): void; onNotify(text: string): void }) {
  const [state, setState] = useState<Loaded<SellerShopProduct>>(null);
  const [adding, setAdding] = useState(false);
  const [reload, setReload] = useState(0);
  const approved = seller.status === 'APPROVED';

  useEffect(() => {
    let live = true;
    sellersApi
      .products(seller.id)
      .then((rows) => live && setState({ rows }))
      .catch((err) => live && setState(notReady(err) ? { notReady: true } : { error: errorMessage(err, "Could not load this seller's products.") }));
    return () => {
      live = false;
    };
  }, [seller.id, reload]);

  const rows = state && 'rows' in state ? state.rows : [];

  return (
    <section className="card" aria-label="Products">
      <h2 className="growth-card__title">Products</h2>
      {state === null ? (
        <p className="sellers-card__meta">Loading…</p>
      ) : 'notReady' in state ? (
        <p className="sellers-card__meta">Available after the next database update.</p>
      ) : 'error' in state ? (
        <p className="field__error" role="alert">
          {state.error}
        </p>
      ) : (
        <p className="sellers-card__meta">{productCountsText(rows)}</p>
      )}

      {approved ? (
        <div className="sellers-actions">
          <button type="button" className="button button--ink" onClick={() => setAdding(true)}>
            Add product
          </button>
          {seller.submissions_pending > 0 ? (
            <Link className="button" style={{ textAlign: 'center' }} to={`/more/seller-products?seller=${seller.id}`}>
              {seller.submissions_pending} waiting for approval
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="sellers-card__meta">Approve this seller to add products for them.</p>
      )}

      {rows.length > 0 ? (
        <ul className="seller-products" aria-label="Seller products">
          {rows.map((p) => (
            <li key={p.id} aria-label={p.name}>
              {p.image_url ? <img className="seller-products__thumb" src={p.image_url} alt="" /> : <span className="seller-products__thumb seller-products__thumb--empty" aria-hidden="true" />}
              <span className="seller-products__text">
                <strong>{p.name}</strong>
                <span className="sellers-card__meta">{p.category_name ?? 'No category'}</span>
                <span className="sellers-card__meta">
                  Seller {p.seller_price == null ? '—' : lkr(p.seller_price)} · Customer {p.selling_price == null ? '—' : lkr(p.selling_price)}
                </span>
                <span className="sellers-card__meta">{p.stock_on_hand === null || p.stock_on_hand === undefined ? 'Stock not tracked' : `Stock ${p.stock_on_hand}`}</span>
              </span>
              <span className="seller-products__chip" title={PRODUCT_STATUS_HELP[p.status]}>
                <Status tone={TONE[p.status]}>{PRODUCT_STATUS_LABEL[p.status]}</Status>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <AddProductSheet
          seller={seller}
          onClose={() => setAdding(false)}
          onAdded={(p) => {
            setAdding(false);
            setReload((n) => n + 1);
            onAdded();
            onNotify(`${p.name} is added for ${seller.shop_name} and is live.`);
          }}
        />
      ) : null}
    </section>
  );
}

/** Photo, name, category, unit, pack size, description, both prices, barcode and opening stock. */
function AddProductSheet({ seller, onClose, onAdded }: { seller: AdminSeller; onClose(): void; onAdded(p: SellerShopProduct): void }) {
  const [form, setForm] = useState<NewShopProductForm>(EMPTY_SHOP_PRODUCT);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Partial<Record<ShopProductField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    catalog.categories
      .list()
      .then((rows) => live && setCategories(rows))
      .catch(() => live && setCategories([]));
    return () => {
      live = false;
    };
  }, []);

  const options = useMemo(() => categoryOptions(categories).filter((o) => o.isActive), [categories]);
  const set = (key: keyof NewShopProductForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
    setFormError(null);
  };
  const note = belowSellerPriceNote(form.seller_price, form.selling_price);

  async function save() {
    const read = newShopProductBody(form);
    if ('errors' in read) {
      setErrors(read.errors);
      setFormError(null);
      return;
    }
    setBusy(true);
    try {
      onAdded(await sellersApi.addProduct(seller.id, read.body));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMAGE_REQUIRED') {
        setErrors({ image_url: err.message || 'Add a photo of the product.' });
      } else {
        setFormError(errorMessage(err, 'Could not add the product.'));
      }
      setBusy(false);
    }
  }

  return (
    <Sheet
      label="Add product"
      title={`Add a product for ${seller.shop_name}`}
      message="The product goes live straight away, owned by this seller. A photo is required."
      busy={busy}
      submitLabel={busy ? 'Adding…' : 'Add product'}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className="seller-photo" role="group" aria-label="Product photo (required)">
        <ImageUploader
          value={form.image_url}
          folder="products"
          label="Photo (required)"
          onChange={(url) => {
            setForm((f) => ({ ...f, image_url: url }));
            setErrors((x) => ({ ...x, image_url: undefined }));
          }}
        />
        {errors.image_url ? (
          <p className="field__error-text" role="alert">
            {errors.image_url}
          </p>
        ) : null}
      </div>
      <TextField label="Product name" error={errors.name ?? null}>
        <input className="input" maxLength={160} value={form.name} onChange={set('name')} />
      </TextField>
      <TextField label="Category" error={errors.category_id ?? null}>
        <select className="input" value={form.category_id} onChange={set('category_id')}>
          <option value="">Choose a category</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </TextField>
      <TextField label="Unit" error={errors.unit ?? null} hint="e.g. 1 kg, 500 g, each">
        <input className="input" maxLength={40} value={form.unit} onChange={set('unit')} />
      </TextField>
      <TextField label="Pack size (optional)">
        <input className="input" maxLength={60} value={form.pack_size} onChange={set('pack_size')} />
      </TextField>
      <TextField label="Description (optional)">
        <textarea className="input" rows={3} maxLength={1000} value={form.description} onChange={set('description')} />
      </TextField>
      <TextField label="Seller price (LKR)" error={errors.seller_price ?? null} hint="What Blynk pays the seller for one unit.">
        <input className="input" inputMode="decimal" value={form.seller_price} onChange={set('seller_price')} />
      </TextField>
      <TextField label="Customer price (LKR)" error={errors.selling_price ?? null} hint="What customers pay.">
        <input className="input" inputMode="decimal" value={form.selling_price} onChange={set('selling_price')} />
      </TextField>
      {note ? (
        <p className="seller-warn" role="note">
          {note}
        </p>
      ) : null}
      <TextField label="Barcode (optional)">
        <input className="input" maxLength={60} value={form.barcode} onChange={set('barcode')} />
      </TextField>
      <TextField label="Opening stock (optional)" error={errors.stock_quantity ?? null} hint="Leave empty to not track stock.">
        <input className="input" inputMode="numeric" value={form.stock_quantity} onChange={set('stock_quantity')} />
      </TextField>
      {formError ? (
        <p className="field__error" role="alert">
          {formError}
        </p>
      ) : null}
    </Sheet>
  );
}
