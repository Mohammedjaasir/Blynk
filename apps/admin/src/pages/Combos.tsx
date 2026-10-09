import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { combos as combosApi, products as productsApi } from '../api/resources';
import type { AdminProduct, Combo, ComboInput } from '../api/types';
import { ImageUploader } from '../components/ImageUploader';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { comboProblems, comboStatus, endOfDay, itemsTotal, productPrice, type ComboPick } from '../lib/combos';
import { colomboDate, formatDay } from '../lib/coupons';
import { useImageCleanup } from '../lib/imageCleanup';
import { formatMoney } from '../lib/orders';

/**
 * Combo packs (owner, 2026-10-09; migration 033): products sold together at
 * one lower price - "Breakfast pack: bread + eggs + milk". Live ones show on
 * the customer Home as a "Combo packs" rail. The API decides what is live:
 * a combo whose items have become cheaper than it simply stops showing.
 */
export function Combos() {
  const toast = useToast();
  const [rows, setRows] = useState<Combo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Combo | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Combo | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await combosApi.list());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load combo packs.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(combo: Combo) {
    try {
      await combosApi.update(combo.id, { is_active: !combo.is_active });
      toast.success(`${combo.name} is now switched ${combo.is_active ? 'off' : 'on'}.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the combo.'));
    }
  }

  async function remove(combo: Combo) {
    try {
      await combosApi.remove(combo.id);
      toast.success(`${combo.name} is deleted.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the combo.'));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Combo packs"
        description="Products sold together at one lower price. Live packs show on the customer Home."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add combo
          </button>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading combo packs" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No combo packs yet"
          message="Put two or more products together at a price lower than buying them one by one."
          action={
            <button type="button" className="button" onClick={() => setEditing('new')}>
              Add the first combo
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Image</th>
                <th scope="col">Combo</th>
                <th scope="col" className="num">Price</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Order</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((combo) => {
                const status = comboStatus(combo);
                return (
                  <tr key={combo.id}>
                    <td>
                      <ComboThumb combo={combo} />
                    </td>
                    <td>
                      <span className="cell__primary">{combo.name}</span>
                      <span className="cell__secondary">
                        {combo.items.map((i) => `${i.name} × ${i.quantity}`).join(' · ')}
                      </span>
                    </td>
                    <td className="num">
                      <span className="mono">{formatMoney(combo.price)}</span>
                      <span className="cell__secondary">{`Items ${formatMoney(combo.items_total)}`}</span>
                      {combo.saving > 0 ? (
                        <span className="cell__secondary combo-saving">{`Saves ${formatMoney(combo.saving)}`}</span>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      {combo.ends_at ? (
                        <span className="cell__secondary">
                          {`${Date.parse(combo.ends_at) <= Date.now() ? 'Ended' : 'Ends'} ${formatDay(combo.ends_at)}`}
                        </span>
                      ) : null}
                    </td>
                    <td className="num">{combo.display_order}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => setEditing(combo)}
                          aria-label={`Edit ${combo.name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => void toggleActive(combo)}
                        >
                          {combo.is_active ? 'Switch off' : 'Switch on'}
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete combo"
          message={`Delete ${pendingDelete.name}? Customers will no longer see it. Past orders keep it.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

      {editing ? (
        <ComboDialog
          combo={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

/** The combo's own image, else up to three of its products' images. */
function ComboThumb({ combo }: { combo: Combo }) {
  if (combo.image_url) {
    return (
      <div className="thumb">
        <img src={combo.image_url} alt="" />
      </div>
    );
  }
  const images = combo.items.filter((i) => i.image_url).slice(0, 3);
  if (images.length === 0) {
    return (
      <div className="thumb">
        <span className="thumb__empty">—</span>
      </div>
    );
  }
  return (
    <div className="combo-thumbs" aria-hidden="true">
      {images.map((i) => (
        <span key={i.product_id} className="combo-thumbs__item">
          <img src={i.image_url!} alt="" />
        </span>
      ))}
    </div>
  );
}

interface FormState {
  name: string;
  description: string;
  price: string;
  image_url: string | null;
  /** YYYY-MM-DD in Colombo; blank = no end. */
  ends_on: string;
  is_active: boolean;
  display_order: string;
  picks: ComboPick[];
}

function formFrom(combo: Combo | null): FormState {
  return {
    name: combo?.name ?? '',
    description: combo?.description ?? '',
    price: combo ? String(combo.price) : '',
    image_url: combo?.image_url ?? null,
    ends_on: combo?.ends_at ? colomboDate(combo.ends_at) : '',
    is_active: combo?.is_active ?? true,
    display_order: String(combo?.display_order ?? 0),
    picks: (combo?.items ?? []).map((i) => ({
      product_id: i.product_id,
      name: i.name,
      unit_price: i.unit_price,
      image_url: i.image_url,
      quantity: String(i.quantity),
    })),
  };
}

function ComboDialog({
  combo,
  onClose,
  onSaved,
}: {
  combo: Combo | null;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => formFrom(combo));
  const [fieldErrors, setFieldErrors] = useState<{ price?: string; ends_on?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const images = useImageCleanup([combo?.image_url]);
  const storedEndsAt = combo?.ends_at ?? null;
  const storedEndsOn = storedEndsAt ? colomboDate(storedEndsAt) : '';
  const inactiveIds = useMemo(
    () => new Set((combo?.items ?? []).filter((i) => !i.is_active).map((i) => i.product_id)),
    [combo]
  );

  const total = itemsTotal(form.picks);
  const price = Number(form.price);
  const problems = comboProblems(form);
  const endProblem =
    form.ends_on && form.ends_on !== storedEndsOn && form.ends_on < colomboDate() ? 'Pick today or a later day' : null;
  const canSave = problems.length === 0 && !endProblem && !saving;

  function setPicks(picks: ComboPick[]) {
    setForm((f) => ({ ...f, picks }));
  }

  function addProduct(product: AdminProduct) {
    if (form.picks.some((p) => p.product_id === product.id)) {
      // Already in: one more instead of a second line (the API refuses duplicates).
      setPicks(
        form.picks.map((p) =>
          p.product_id === product.id ? { ...p, quantity: String((Number(p.quantity) || 0) + 1) } : p
        )
      );
      return;
    }
    setPicks([
      ...form.picks,
      {
        product_id: product.id,
        name: product.name,
        unit_price: productPrice(product),
        image_url: product.image_url,
        quantity: '1',
      },
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});
    const payload: ComboInput = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      image_url: form.image_url,
      price,
      is_active: form.is_active,
      display_order: Math.max(0, Math.floor(Number(form.display_order) || 0)),
      items: form.picks.map((p) => ({ product_id: p.product_id, quantity: Number(p.quantity) })),
      // An unchanged end goes back exactly as stored.
      ends_at: !form.ends_on ? null : form.ends_on === storedEndsOn ? storedEndsAt : endOfDay(form.ends_on),
    };
    try {
      if (combo) {
        await combosApi.update(combo.id, payload);
        toast.success(`${payload.name} is saved.`);
      } else {
        await combosApi.create(payload);
        toast.success(`${payload.name} is added.`);
      }
      await images.afterSave([payload.image_url]);
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'COMBO_PRICE_NOT_LOWER') {
        const itemsTotalNow = Number((err.details as { items_total?: number } | undefined)?.items_total);
        setFieldErrors({
          price: Number.isFinite(itemsTotalNow)
            ? `The combo price must be lower than the items today (${formatMoney(itemsTotalNow)}).`
            : err.message,
        });
      } else if (err instanceof ApiError && err.code === 'OFFER_END_IN_PAST') {
        setFieldErrors({ ends_on: err.message });
      } else {
        setError(errorMessage(err, 'Could not save the combo.'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Combo pack">
      <form className="modal__panel modal__panel--wide" onSubmit={submit} noValidate>
        <h2 className="modal__title">{combo ? 'Edit combo' : 'Add combo'}</h2>

        <section className="editor__section">
          <h3 className="editor__legend">Products in the pack</h3>
          <ProductPicker onPick={addProduct} />
          {form.picks.length === 0 ? (
            <p className="form__note">Search above and add the products this pack holds.</p>
          ) : (
            <ul className="combo-picks" aria-label="Products in the combo">
              {form.picks.map((pick) => {
                const q = Number(pick.quantity);
                const lineOk = Number.isInteger(q) && q >= 1 && q <= 100;
                return (
                  <li key={pick.product_id} className="combo-picks__row">
                    <span className="thumb combo-picks__thumb">
                      {pick.image_url ? <img src={pick.image_url} alt="" /> : <span className="thumb__empty">—</span>}
                    </span>
                    <span className="combo-picks__name">
                      <span className="cell__primary">{pick.name}</span>
                      <span className="cell__secondary">
                        {`${formatMoney(pick.unit_price)} each`}
                        {inactiveIds.has(pick.product_id) ? ' · switched off' : ''}
                      </span>
                    </span>
                    <span className="stepper">
                      <button
                        type="button"
                        className="stepper__button"
                        aria-label={`One less ${pick.name}`}
                        disabled={!lineOk || q <= 1}
                        onClick={() =>
                          setPicks(form.picks.map((p) => (p === pick ? { ...p, quantity: String(q - 1) } : p)))
                        }
                      >
                        −
                      </button>
                      <input
                        className="stepper__input mono"
                        inputMode="numeric"
                        aria-label={`Quantity of ${pick.name}`}
                        value={pick.quantity}
                        onChange={(e) =>
                          setPicks(form.picks.map((p) => (p === pick ? { ...p, quantity: e.target.value } : p)))
                        }
                      />
                      <button
                        type="button"
                        className="stepper__button"
                        aria-label={`One more ${pick.name}`}
                        disabled={lineOk && q >= 100}
                        onClick={() =>
                          setPicks(
                            form.picks.map((p) => (p === pick ? { ...p, quantity: String(lineOk ? q + 1 : 1) } : p))
                          )
                        }
                      >
                        +
                      </button>
                    </span>
                    <span className="combo-picks__total mono">{lineOk ? formatMoney(pick.unit_price * q) : '—'}</span>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Remove ${pick.name}`}
                      onClick={() => setPicks(form.picks.filter((p) => p !== pick))}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Pack</h3>
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" hint="Optional. Shown on the combo in the customer app">
            <textarea
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <div className="form__row">
            <Field label="Combo price (LKR)" error={fieldErrors.price}>
              <input
                className="input"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>
            <Field label="Display order" hint="Lower numbers show first">
              <input
                className="input"
                inputMode="numeric"
                value={form.display_order}
                onChange={(e) => setForm({ ...form, display_order: e.target.value })}
              />
            </Field>
          </div>

          <div className="combo-summary" role="status" aria-label="Combo summary">
            <span>
              Items separately <strong className="mono">{formatMoney(total)}</strong>
            </span>
            <span aria-hidden="true">{' · '}</span>
            <span>
              Combo <strong className="mono">{form.price.trim() && price > 0 ? formatMoney(price) : '—'}</strong>
            </span>
            <span aria-hidden="true">{' · '}</span>
            <span className={total - price > 0 && price > 0 ? 'combo-summary__saving' : undefined}>
              Saves{' '}
              <strong className="mono">
                {form.price.trim() && price > 0 && total - price > 0 ? formatMoney(Math.round((total - price) * 100) / 100) : '—'}
              </strong>
            </span>
          </div>

          <ImageUploader
            value={form.image_url}
            folder="promotions"
            label="Image (optional; without one the app shows the products' photos)"
            onChange={(url) => {
              images.track(url);
              setForm((f) => ({ ...f, image_url: url }));
            }}
          />
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">When</h3>
          <Field
            label="Ends"
            hint="Optional. The pack runs to the end of this day"
            error={fieldErrors.ends_on ?? endProblem ?? undefined}
          >
            <input
              className="input"
              type="date"
              value={form.ends_on}
              min={colomboDate()}
              onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
            />
          </Field>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span>
              <strong>Active</strong>
              <em>Switched off packs are hidden from customers.</em>
            </span>
          </label>
        </section>

        {problems.length > 0 ? (
          <ul className="combo-problems" aria-label="Before you can save">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="field__error">{error}</p> : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={!canSave}>
            {saving ? <Spinner label="Saving" /> : combo ? 'Save combo' : 'Add combo'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Search active products by name or SKU and add one to the pack. */
function ProductPicker({ onPick }: { onPick(product: AdminProduct): void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      productsApi
        .listAllAdmin({ search, is_active: true })
        .then((r) => live && (setResults(r.products.slice(0, 8)), setError(null)))
        .catch((err) => live && setError(errorMessage(err, 'Could not search products.')));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="combo-search">
      <Field label="Add a product">
        <input
          className="input"
          type="search"
          placeholder="Search by name or SKU"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      {error ? <p className="field__error">{error}</p> : null}
      {results && results.length === 0 ? <p className="form__note">No active product matches.</p> : null}
      {results && results.length > 0 ? (
        <ul className="combo-search__results" aria-label="Search results">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="combo-search__result"
                aria-label={`Add ${product.name}`}
                onClick={() => onPick(product)}
              >
                <span className="combo-search__name">
                  {product.name}
                  <span className="cell__secondary">{`${product.sku} · ${product.unit}`}</span>
                </span>
                <span className="mono">{formatMoney(productPrice(product))}</span>
                <span className="combo-search__add" aria-hidden="true">
                  Add
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
