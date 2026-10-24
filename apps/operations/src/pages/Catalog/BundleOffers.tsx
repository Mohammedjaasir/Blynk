import { useCallback, useEffect, useState } from 'react';
import { catalog, settings } from '../../api/resources';
import type { Category } from '../../api/types';
import { Badge, Field, Spinner } from '../../components/ui';
import { PageHeader } from '../../components/Layout';
import { Switch } from '../../components/RiderDocuments';
import { catalogErrorMessage, categoryOptions } from '../../lib/catalog';
import {
  BUNDLE_LIMITS,
  BUNDLE_STATUS_WORDS,
  blankDraft,
  bundleOfferSummary,
  bundlePreview,
  bundleProblem,
  bundleScopeText,
  bundleStatus,
  bundlesPayload,
  bundlesProblem,
  draftFrom,
  fromLocalInput,
  scheduleText,
  toLocalInput,
  type BundleDraft,
  type BundleOffersSetting,
  type BundleStatus,
  type BundleType,
} from '../../lib/bundleOffers';
import { TargetProductPicker } from './Promotions';

/**
 * Bundle offers (owner, 2026-10-25: "buy 2 get 1", "spend X, get a gift"). Staff make offers that run
 * inside the real order pricing: buy N of some products (or a category) and the cheapest M are free,
 * or spend an amount and a gift product is added at LKR 0. Each can be scheduled (Sri Lanka time) and
 * switched off. The customer app shows a badge on the products, a progress card and the free lines in
 * the cart. Admin has the same page (apps/admin/src/pages/BundleOffers.tsx); this is Blynk Ops own copy.
 */
const TONE: Record<BundleStatus, 'active' | 'inactive' | 'muted'> = { LIVE: 'active', SCHEDULED: 'muted', ENDED: 'muted', OFF: 'inactive' };
const TOUCH = { minHeight: 44, minWidth: 44 } as const;
const TYPE_WORDS: Record<BundleType, string> = { BUY_X_GET_Y: 'Buy and get free', SPEND_GET_GIFT: 'Spend and get a gift' };

/** The words customers see for this offer: the card badge and the cart lines. */
function OfferPreview({ draft }: { draft: BundleDraft }) {
  const p = bundlePreview(draft);
  return (
    <div className="field" aria-label="Preview of what customers see">
      <span className="field__label">What customers see</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '1px solid var(--line, #e3e6ec)', borderRadius: 12 }}>
        {p.badge ? (
          <span>
            <span className="field__hint">On the product card and page: </span>
            <span data-testid="preview-badge" style={{ background: '#ffd84d', color: '#14161a', borderRadius: 999, padding: '3px 10px', fontWeight: 600, fontSize: 13 }}>
              {p.badge}
            </span>
          </span>
        ) : null}
        {p.cart.map((line, i) => (
          <span key={line} data-testid={i === 0 ? 'preview-progress' : 'preview-line'}>
            <span className="field__hint">{i === 0 ? 'In the cart, before it applies: ' : 'In the cart, once it applies: '}</span>
            <strong>{line}</strong>
          </span>
        ))}
        {!p.badge && p.cart.length === 0 ? <span className="field__hint">Fill in the offer to see the words.</span> : null}
      </div>
    </div>
  );
}

function OfferEditor({ draft, categories, onChange }: { draft: BundleDraft; categories: Category[]; onChange(change: Partial<BundleDraft>): void }) {
  const options = categoryOptions(categories);
  const ids = draft.product_ids ?? [];
  const byCategory = !!draft.category_id || draft.scopeMode === 'CATEGORY';
  const full = ids.length >= BUNDLE_LIMITS.products;
  return (
    <div className="editor__section" style={{ marginTop: 8 }}>
      <Field label="Title" hint={`${draft.title.trim().length}/${BUNDLE_LIMITS.title.max} - shown to staff and in the app's offer text`}>
        <input
          className="input"
          aria-label="Title"
          maxLength={BUNDLE_LIMITS.title.max}
          value={draft.title}
          placeholder={draft.type === 'BUY_X_GET_Y' ? 'Juice buy 2 get 1' : 'Spend 3000, get a biscuit pack'}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>

      {draft.type === 'BUY_X_GET_Y' ? (
        <>
          <div className="form__row">
            <Field label="Buy" hint="Units the customer pays for">
              <input className="input" type="number" inputMode="numeric" aria-label="Buy quantity" min={BUNDLE_LIMITS.qty.min} max={BUNDLE_LIMITS.qty.max} value={draft.buy_qty ?? ''} onChange={(e) => onChange({ buy_qty: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Get free" hint="The cheapest units in each group">
              <input className="input" type="number" inputMode="numeric" aria-label="Free quantity" min={BUNDLE_LIMITS.qty.min} max={BUNDLE_LIMITS.qty.max} value={draft.get_qty ?? ''} onChange={(e) => onChange({ get_qty: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Applies to">
            <select
              className="input"
              aria-label="Applies to"
              value={byCategory ? 'CATEGORY' : 'PRODUCTS'}
              onChange={(e) =>
                onChange(
                  e.target.value === 'CATEGORY'
                    ? { scopeMode: 'CATEGORY', product_ids: null, products: [], category_id: null, category_name: '' }
                    : { scopeMode: 'PRODUCTS', product_ids: [], products: [], category_id: null, category_name: '' }
                )
              }
            >
              <option value="PRODUCTS">Products I pick</option>
              <option value="CATEGORY">A whole category</option>
            </select>
          </Field>
          {byCategory ? (
            <Field label="Category" hint="Its products and its sub-categories' products. Units from different products in it count together.">
              <select
                className="input"
                aria-label="Category"
                value={draft.category_id ?? ''}
                onChange={(e) => {
                  const opt = options.find((o) => o.id === e.target.value);
                  onChange({ category_id: e.target.value || null, category_name: opt?.label ?? '' });
                }}
              >
                <option value="">Select a category</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.isActive ? '' : ' (off)'}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <p className="field__hint" aria-live="polite">
                {ids.length} of {BUNDLE_LIMITS.products} picked. Units of any of them count together.
              </p>
              <div className="band-list">
                {draft.products.map((p) => (
                  <div className="band-list__row" key={p.id} style={{ flexWrap: 'wrap', gap: 8 }} data-testid="picked-product">
                    <span style={{ flex: '1 1 160px' }}>{p.name}</span>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      style={TOUCH}
                      aria-label={`Remove ${p.name} from the offer`}
                      onClick={() => onChange({ products: draft.products.filter((x) => x.id !== p.id), product_ids: ids.filter((x) => x !== p.id) })}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {full ? (
                <p className="form__note">That is the most an offer can hold. Remove one to add another.</p>
              ) : (
                <TargetProductPicker
                  selectedId={null}
                  selectedName={null}
                  onPick={(product) => {
                    if (!product || ids.includes(product.id)) return;
                    onChange({ products: [...draft.products, { id: product.id, name: product.name }], product_ids: [...ids, product.id] });
                  }}
                />
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="form__row">
            <Field label="Spend (LKR)" hint="The basket total after discounts that unlocks the gift">
              <input className="input" type="number" inputMode="decimal" aria-label="Spend" min={BUNDLE_LIMITS.minSubtotal.min} value={draft.min_subtotal ?? ''} onChange={(e) => onChange({ min_subtotal: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Gift quantity" hint="One gift per order">
              <input className="input" type="number" inputMode="numeric" aria-label="Gift quantity" min={BUNDLE_LIMITS.giftQty.min} max={BUNDLE_LIMITS.giftQty.max} value={draft.gift_qty ?? ''} onChange={(e) => onChange({ gift_qty: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          </div>
          <TargetProductPicker
            selectedId={draft.gift_product_id}
            selectedName={draft.gift_product_name || null}
            onPick={(product) => onChange({ gift_product_id: product?.id ?? null, gift_product_name: product?.name ?? '' })}
          />
          <p className="field__hint">The gift is added only while it is in stock. Label this product as the gift in your stock as usual; it goes out at LKR 0.</p>
        </>
      )}

      <p className="card__row">
        <Switch checked={draft.is_active} onToggle={() => onChange({ is_active: !draft.is_active })} label="Offer is on" />
        <span>Offer is on</span>
      </p>
      <div className="form__row">
        <Field label="Starts" hint="Optional - empty means straight away (Sri Lanka time)">
          <input className="input" type="datetime-local" aria-label="Starts" value={toLocalInput(draft.starts_at)} onChange={(e) => onChange({ starts_at: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Ends" hint="Optional - empty means it stays on (Sri Lanka time)">
          <input className="input" type="datetime-local" aria-label="Ends" value={toLocalInput(draft.ends_at)} onChange={(e) => onChange({ ends_at: fromLocalInput(e.target.value) })} />
        </Field>
      </div>

      <OfferPreview draft={draft} />
    </div>
  );
}

export function BundleOffers() {
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<BundleOffersSetting | null>(null);
  const [rows, setRows] = useState<BundleDraft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const adopt = useCallback((s: BundleOffersSetting) => {
    setSaved(s);
    setRows(s.offers.map(draftFrom));
    setEditing(null);
  }, []);

  useEffect(() => {
    settings.bundleOffers
      .get()
      .then((s) => {
        adopt(s);
        setLoadError(null);
      })
      .catch((err) => setLoadError(catalogErrorMessage(err)));
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
  }, [adopt]);

  const dirty = saved ? JSON.stringify(bundlesPayload(rows)) !== JSON.stringify(bundlesPayload(saved.offers.map(draftFrom))) : false;
  const problem = bundlesProblem(rows);

  const patch = (key: string, change: Partial<BundleDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function add(type: BundleType) {
    const draft = blankDraft(type);
    setRows((rs) => [...rs, draft]);
    setEditing(draft.key);
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (problem) return;
    setSaving(true);
    try {
      adopt(await settings.bundleOffers.update(bundlesPayload(rows)));
      setNotice('Bundle offers saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Bundle offers" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!saved) return <Spinner label="Loading the bundle offers" />;

  const now = new Date();
  return (
    <>
      <PageHeader
        title="Bundle offers"
        description='Offers like "Buy 2 get 1 free" or "Spend LKR 3,000 and get a free gift". They are worked out in the real order total, shown on the product, and appear as free lines in the customer cart.'
      />

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <section className="editor__section">
          <h3 className="editor__legend">Offers</h3>
          {rows.length === 0 ? <p className="form__note">No bundle offers yet. Add one below.</p> : null}
          <div className="band-list">
            {rows.map((r) => {
              const status = bundleStatus(r, now);
              const label = r.title.trim() || 'New offer';
              return (
                <div key={r.key} data-testid="bundle-row" style={{ border: '1px solid var(--line, #e3e6ec)', borderRadius: 12, padding: 10 }}>
                  <div className="band-list__row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ flex: '2 1 200px' }}>
                      <strong>{label}</strong> <Badge tone={TONE[status]}>{BUNDLE_STATUS_WORDS[status]}</Badge>
                      <br />
                      <span className="field__hint">
                        {TYPE_WORDS[r.type]} · {bundleOfferSummary(r)} · {bundleScopeText(r)} · {scheduleText(r)}
                      </span>
                    </span>
                    <button type="button" className="button button--ghost button--sm" style={TOUCH} aria-label={`${editing === r.key ? 'Close' : 'Edit'} ${label}`} aria-expanded={editing === r.key} onClick={() => setEditing(editing === r.key ? null : r.key)}>
                      {editing === r.key ? 'Close' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      style={TOUCH}
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        setRows((rs) => rs.filter((x) => x.key !== r.key));
                        if (editing === r.key) setEditing(null);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {editing === r.key ? <OfferEditor draft={r} categories={categories} onChange={(change) => patch(r.key, change)} /> : null}
                  {editing !== r.key && bundleProblem(r) ? (
                    <p className="field__error" style={{ marginTop: 6 }}>
                      {bundleProblem(r)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="button button--ghost" style={TOUCH} disabled={rows.length >= BUNDLE_LIMITS.offers} onClick={() => add('BUY_X_GET_Y')}>
              Add a "buy and get free" offer
            </button>
            <button type="button" className="button button--ghost" style={TOUCH} disabled={rows.length >= BUNDLE_LIMITS.offers} onClick={() => add('SPEND_GET_GIFT')}>
              Add a "spend and get a gift" offer
            </button>
          </div>
          {rows.length >= BUNDLE_LIMITS.offers ? <p className="field__hint">That is the most the shop can hold ({BUNDLE_LIMITS.offers}).</p> : null}
        </section>

        {saved.ready === false ? (
          <p className="form__note" role="status">
            You can set offers up now. They start working for customers once the shop's update (database step 062) has been run.
          </p>
        ) : null}
        {error || problem ? (
          <p className="field__error" role="alert">
            {error ?? problem}
          </p>
        ) : null}
        {notice ? (
          <p className="form__note" role="status">
            {notice}
          </p>
        ) : null}
        <div className="band-save-bar">
          <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => saved && adopt(saved)}>
            Discard changes
          </button>
          <button type="submit" className="button" disabled={!dirty || saving || !!problem}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </>
  );
}
