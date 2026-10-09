import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { deleteImagesQuietly } from '../../api/client';
import { catalog } from '../../api/resources';
import type { AdminProduct, Combo, ComboInput } from '../../api/types';
import { ImageUploader } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { ConfirmDialog, EmptyState, Field, Spinner, Status } from '../../components/ui';
import {
  MAX_COMBO_ITEM_QTY,
  catalogErrorMessage,
  colomboDay,
  colomboTodayDay,
  comboNotLiveLabel,
  comboRuleError,
  formatColomboDate,
  offerEndForDay,
  parseComboPrice,
  parseDisplayOrder,
  productCustomerPrice,
} from '../../lib/catalog';
import { replacedImages } from '../../lib/image';
import { formatMoney } from '../../lib/orders';

/**
 * Combo packs (migration 033; owner, 2026-10-09): several products sold
 * together for one price lower than buying them separately, e.g. a
 * "Breakfast pack". Listed with their price against the items' total today,
 * the saving, and whether customers can see them right now - `is_live`,
 * `not_live_reason` and `is_available` are the backend's word, never worked
 * out here. A combo whose items have since become cheaper than it is hidden
 * by the server; the row says so in plain words.
 */
export function Combos() {
  const [rows, setRows] = useState<Combo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Combo | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Combo | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await catalog.combos.list());
      setError(null);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(combo: Combo) {
    try {
      await catalog.combos.remove(combo.id);
      setNotice(`${combo.name} was deleted.`);
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    } finally {
      setPendingDelete(null);
    }
  }

  const addButton = (
    <button type="button" className="button" onClick={() => setEditing('new')}>
      Add combo
    </button>
  );

  return (
    <div className="page">
      <PageHeader
        title="Combo packs"
        description="Products sold together for one lower price, shown to customers while they are live."
        actions={addButton}
      />

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading combo packs" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No combo packs yet"
          message="Put two or more products together for one price lower than buying them separately."
          action={addButton}
        />
      ) : (
        <ul className="cat-list">
          {rows.map((combo) => (
            <li key={combo.id} className="cat-row cat-row--flat combo-row">
              <ComboThumb combo={combo} />
              <div className="cat-row__main">
                <p className="cat-row__title">{combo.name}</p>
                <p className="cat-row__meta">{combo.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</p>
                <p className="combo-row__prices">
                  <strong>{formatMoney(combo.price)}</strong>
                  <span className="combo-row__was">{formatMoney(combo.items_total)}</span>
                  {combo.saving > 0 ? <span className="offer-tag">Saves {formatMoney(combo.saving)}</span> : null}
                </p>
                <div className="cat-row__badges">
                  {combo.is_live ? (
                    <Status tone="ok">Live</Status>
                  ) : (
                    <Status tone={combo.not_live_reason === 'NOT_CHEAPER' ? 'warn' : 'muted'}>
                      {comboNotLiveLabel(combo.not_live_reason)}
                    </Status>
                  )}
                  {!combo.is_available ? <Status tone="bad">Sold out</Status> : null}
                  {combo.ends_at && combo.not_live_reason !== 'ENDED' ? (
                    <span className="cat-row__order">Ends {formatColomboDate(combo.ends_at)}</span>
                  ) : null}
                  <span className="cat-row__order">Order {combo.display_order}</span>
                </div>
              </div>
              <div className="cat-row__actions">
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(combo)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => setPendingDelete(combo)}
                  aria-label={`Delete ${combo.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ComboDialog
          combo={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete combo pack"
          message={`Delete "${pendingDelete.name}"? Customers will no longer see it. Past orders keep it.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

/** The combo's own picture, else up to four of its products' pictures. */
function ComboThumb({ combo }: { combo: Combo }) {
  if (combo.image_url) {
    return (
      <div className="cat-row__thumb combo-thumb" aria-hidden="true">
        <img src={combo.image_url} alt="" />
      </div>
    );
  }
  const pictures = combo.items.filter((item) => item.image_url).slice(0, 4);
  return (
    <div className="cat-row__thumb combo-thumb combo-thumb--grid" aria-hidden="true">
      {pictures.length === 0 ? (
        <span className="cat-row__thumb-empty">No image</span>
      ) : (
        pictures.map((item) => <img key={item.product_id} src={item.image_url!} alt="" />)
      )}
    </div>
  );
}

/** A product picked into the combo, with the price a customer pays for it today. */
interface PickedItem {
  product_id: string;
  name: string;
  unit: string | null;
  image_url: string | null;
  /** Null = not known (left out of the total). */
  price: number | null;
  quantity: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function ComboDialog({
  combo,
  onClose,
  onSaved,
}: {
  combo: Combo | null;
  onClose(): void;
  onSaved(message: string): void | Promise<void>;
}) {
  const [name, setName] = useState(combo?.name ?? '');
  const [description, setDescription] = useState(combo?.description ?? '');
  const [price, setPrice] = useState(combo ? String(combo.price) : '');
  const [imageUrl, setImageUrl] = useState<string | null>(combo?.image_url ?? null);
  const savedEndDay = combo?.ends_at ? colomboDay(combo.ends_at) : '';
  const [endDay, setEndDay] = useState(savedEndDay);
  const [isActive, setIsActive] = useState(combo?.is_active ?? true);
  const [displayOrder, setDisplayOrder] = useState(combo ? String(combo.display_order) : '');
  const [items, setItems] = useState<PickedItem[]>(
    () =>
      combo?.items.map((item) => ({
        product_id: item.product_id,
        name: item.name,
        unit: item.unit,
        image_url: item.image_url,
        // `unit_price` is the price today, offers included - what a customer pays.
        price: Number(item.unit_price),
        quantity: item.quantity,
      })) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const endChanged = endDay !== savedEndDay;
  const ended = combo?.ends_at ? new Date(combo.ends_at).getTime() <= Date.now() : false;
  const parsedPrice = price.trim() === '' ? null : parseComboPrice(price);
  const priceValue = parsedPrice && 'value' in parsedPrice ? parsedPrice.value : null;
  const unknownPrice = items.some((item) => item.price === null);
  const itemsTotal = items.length === 0 || unknownPrice ? null : round2(items.reduce((sum, item) => sum + item.price! * item.quantity, 0));
  const ruleError = comboRuleError(items, priceValue, itemsTotal);
  const canSave = !saving && ruleError === null && priceValue !== null && name.trim().length >= 2;

  function setQuantity(productId: string, quantity: number) {
    setItems((current) =>
      current.map((item) =>
        item.product_id === productId ? { ...item, quantity: Math.min(MAX_COMBO_ITEM_QTY, Math.max(1, quantity)) } : item
      )
    );
  }

  function addProduct(product: AdminProduct) {
    setItems((current) =>
      current.some((item) => item.product_id === product.id)
        ? current.map((item) =>
            item.product_id === product.id ? { ...item, quantity: Math.min(MAX_COMBO_ITEM_QTY, item.quantity + 1) } : item
          )
        : [
            ...current,
            {
              product_id: product.id,
              name: product.name,
              unit: product.unit,
              image_url: product.image_url,
              price: productCustomerPrice(product),
              quantity: 1,
            },
          ]
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    if (description.trim().length > 500) next.description = 'Keep the description to 500 characters.';
    if (!parsedPrice) next.price = 'Enter the combo price.';
    else if ('error' in parsedPrice) next.price = parsedPrice.error;
    if (endDay !== '' && endChanged && endDay < colomboTodayDay()) next.ends = 'Pick today or a later day.';
    const order = displayOrder.trim() === '' ? null : parseDisplayOrder(displayOrder, 100_000);
    if (order && 'error' in order) next.display_order = order.error;
    setFieldErrors(next);
    if (Object.keys(next).length > 0 || ruleError || priceValue === null) return;

    const payload: Partial<ComboInput> = {
      name: name.trim(),
      description: description.trim() || null,
      image_url: imageUrl,
      price: priceValue,
      is_active: isActive,
      items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    };
    if (order && 'value' in order) payload.display_order = order.value;
    // The end goes only when it changed (owner, 2026-10-09): the form knows
    // a stored end only as a day, and resending a rebuilt time could move it.
    if (combo ? endChanged : endDay !== '') payload.ends_at = endDay === '' ? null : offerEndForDay(endDay);

    setSaving(true);
    try {
      if (combo) await catalog.combos.update(combo.id, payload);
      else await catalog.combos.create(payload as ComboInput);
      // Saved: only now is a replaced (or removed) picture safe to delete.
      void deleteImagesQuietly(replacedImages([combo?.image_url], [imageUrl]));
      await onSaved(combo ? `${payload.name} was saved.` : `${payload.name} was added.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Combo pack">
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">{combo ? 'Edit combo pack' : 'Add combo pack'}</h2>
        <Field label="Name" error={fieldErrors.name}>
          <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="Optional - shown under the name" error={fieldErrors.description}>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ImageUploader value={imageUrl} folder="products" label="Combo image" onChange={setImageUrl} />
        <p className="field__hint">Optional. Without a picture, customers see the products' own pictures.</p>

        <section className="form__section" aria-labelledby="combo-items-title">
          <h3 className="form__section-title" id="combo-items-title">
            Products in this combo
          </h3>
          {items.length === 0 ? (
            <p className="form__note">Search below and add at least 2 products, or 2 or more of one product.</p>
          ) : (
            <ul className="combo-picked">
              {items.map((item) => (
                <li key={item.product_id} className="combo-picked__row">
                  <div className="combo-picked__thumb" aria-hidden="true">
                    {item.image_url ? <img src={item.image_url} alt="" /> : null}
                  </div>
                  <div className="combo-picked__main">
                    <p className="combo-picked__name">{item.name}</p>
                    <p className="cat-row__meta">
                      {[item.unit, item.price === null ? 'price not known' : `${formatMoney(item.price)} each`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="qty-stepper" role="group" aria-label={`Quantity of ${item.name}`}>
                    <button
                      type="button"
                      className="qty-stepper__button"
                      aria-label={`One less ${item.name}`}
                      disabled={item.quantity <= 1}
                      onClick={() => setQuantity(item.product_id, item.quantity - 1)}
                    >
                      −
                    </button>
                    <span className="qty-stepper__value mono" aria-live="polite">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      className="qty-stepper__button"
                      aria-label={`One more ${item.name}`}
                      disabled={item.quantity >= MAX_COMBO_ITEM_QTY}
                      onClick={() => setQuantity(item.product_id, item.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => setItems((current) => current.filter((i) => i.product_id !== item.product_id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ProductSearch pickedIds={items.map((item) => item.product_id)} onPick={addProduct} />
        </section>

        <div className="form__row">
          <Field label="Combo price (LKR)" error={fieldErrors.price}>
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
        </div>

        <ComboSummary itemsTotal={itemsTotal} price={priceValue} unknownPrice={unknownPrice} />
        {ruleError && items.length > 0 ? (
          <p className="field__error" role="alert">
            {ruleError}
          </p>
        ) : null}

        <div className="form__row">
          <Field
            label="Ends"
            hint={ended && !endChanged ? 'This combo has ended. Pick a new day, or clear it for no end.' : 'Optional - the combo runs to the end of this day'}
            error={fieldErrors.ends}
          >
            <input
              className="input"
              type="date"
              value={endDay}
              min={ended && !endChanged ? undefined : colomboTodayDay()}
              onChange={(e) => setEndDay(e.target.value)}
            />
          </Field>
          <Field label="Display order" hint="Optional - lower numbers show first" error={fieldErrors.display_order}>
            <input
              className="input"
              inputMode="numeric"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
            />
          </Field>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>
            <strong>On sale</strong>
            <em>Switched off, customers do not see this combo.</em>
          </span>
        </label>

        {error ? <p className="field__error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={!canSave}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** "Items separately LKR X · Combo LKR Y · Customer saves LKR Z", live. */
function ComboSummary({
  itemsTotal,
  price,
  unknownPrice,
}: {
  itemsTotal: number | null;
  price: number | null;
  unknownPrice: boolean;
}) {
  if (unknownPrice) {
    return <p className="form__note">A product's price is not known, so the saving cannot be shown. The server checks it on save.</p>;
  }
  if (itemsTotal === null) return null;
  const saving = price === null ? null : round2(itemsTotal - price);
  return (
    <p className={`combo-summary${saving !== null && saving <= 0 ? ' combo-summary--bad' : ''}`} role="status">
      <span>Items separately {formatMoney(itemsTotal)}</span>
      {price !== null ? <span>Combo {formatMoney(price)}</span> : null}
      {saving !== null && saving > 0 ? <strong>Customer saves {formatMoney(saving)}</strong> : null}
      {saving !== null && saving <= 0 ? <strong>Not cheaper than the items</strong> : null}
    </p>
  );
}

/**
 * Find products to add - the same `GET /admin/products?search=` the Products
 * screen uses, active products only, a short pause after typing.
 */
function ProductSearch({ pickedIds, onPick }: { pickedIds: string[]; onPick(product: AdminProduct): void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = useMemo(() => new Set(pickedIds), [pickedIds]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      catalog.products
        .list({ search: term, is_active: true, limit: 20 })
        .then((rows) => {
          if (!cancelled) {
            setResults(rows);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(catalogErrorMessage(err));
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="combo-search">
      <Field label="Add a product" hint="Type at least 2 letters of its name or SKU">
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
        />
      </Field>
      {busy ? <Spinner label="Searching products" /> : null}
      {error ? <p className="field__error">{error}</p> : null}
      {results && !busy && results.length === 0 ? <p className="form__note">No products match.</p> : null}
      {results && results.length > 0 ? (
        <ul className="combo-search__results" aria-label="Search results">
          {results.map((product) => {
            const productPrice = productCustomerPrice(product);
            return (
              <li key={product.id} className="combo-search__row">
                <span className="combo-search__name">
                  {product.name}
                  <span className="cat-row__meta">
                    {[product.unit, productPrice === null ? null : formatMoney(productPrice), product.is_available ? null : 'out of stock']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={picked.has(product.id) ? `Add one more ${product.name}` : `Add ${product.name}`}
                  onClick={() => onPick(product)}
                >
                  {picked.has(product.id) ? '+1' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
