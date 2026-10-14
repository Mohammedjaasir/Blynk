import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { deleteImagesQuietly } from '../../api/client';
import { catalog } from '../../api/resources';
import type { AdminProduct, Category, CategoryGroup, Promotion } from '../../api/types';
import {
  BackgroundPicker,
  SOLID_SWATCHES,
  usesBackgroundImage,
  type BackgroundValue,
} from '../../components/BackgroundPicker';
import { ImageUploader } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { PromotionPreview } from '../../components/PromotionPreview';
import { PromoCarouselPreview } from '../../components/PromoCarouselPreview';
import { carouselWithDraft } from '../../lib/promoCarousel';
import { Link } from 'react-router-dom';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner } from '../../components/ui';
import {
  MAX_PROMOTION_ORDER,
  catalogErrorMessage,
  categoryOptions,
  describePromotionTarget,
  parseDisplayOrder,
  planReorder,
} from '../../lib/catalog';
import { replacedImages } from '../../lib/image';

/**
 * Home promotions: the carousel at the top of the customer app (task F5,
 * plan §12). Ported from `apps/admin/src/pages/Promotions.tsx` (a fresh
 * implementation, not an import - common.md rule 2). This screen is the
 * only source of that content - the Flutter customer app renders whatever
 * `GET /promotions` returns, in the order and with the background chosen
 * here.
 *
 * Banner targets (2026-10-14): a banner opens the whole catalog, a Main
 * section (category group: CATALOG + group id), a Category or Sub-category
 * (CATEGORY + slug) or a product (PRODUCT + id). The list shows the server's
 * resolved `cta_target`; a target that no longer exists reads "Target
 * missing", and the server's 400 INVALID_PROMOTION_TARGET message is shown
 * in the form as is.
 */
export function Promotions() {
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Promotion | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await catalog.promotions.list());
      setError(null);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
    void catalog.categoryGroups
      .list()
      .then((r) => setGroups(r.groups ?? []))
      .catch(() => setGroups([]));
  }, [load]);

  async function toggleActive(promotion: Promotion) {
    try {
      await catalog.promotions.update(promotion.id, { is_active: !promotion.is_active });
      setNotice(`${promotion.title} is now ${promotion.is_active ? 'hidden from' : 'live on'} Home.`);
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    }
  }

  /** Swaps display_order with the neighbour (renumbering 10, 20, 30... when
   * the two are equal, so the move always shows), then persists in one call. */
  async function move(promotion: Promotion, direction: -1 | 1) {
    if (!rows) return;
    const items = planReorder(rows, promotion.id, direction);
    if (items.length === 0) return;

    try {
      await catalog.promotions.reorder(items);
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    }
  }

  async function remove(promotion: Promotion) {
    try {
      await catalog.promotions.remove(promotion.id);
      setNotice('Promotion deleted.');
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Home promotions"
        description="Active promotions appear in the customer Home carousel, in this order."
        actions={
          <>
            {/* The animated band after the third aisle (owner, 2026-10-14). */}
            <Link to="/catalog/promo-band" className="button button--ghost">
              Edit promo band
            </Link>
            <button type="button" className="button" onClick={() => setEditing('new')}>
              Add promotion
            </button>
          </>
        }
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

      <LivePreviewStrip />

      {rows === null ? (
        <Spinner label="Loading promotions" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No promotions yet"
          message="With no active promotions the customer Home simply hides the carousel."
          action={
            <button type="button" className="button" onClick={() => setEditing('new')}>
              Add the first promotion
            </button>
          }
        />
      ) : (
        <ul className="cat-list">
          {rows.map((promotion, index) => (
            <li key={promotion.id} className="cat-row cat-row--promo">
              <PromotionPreview promotion={promotion} compact />
              <div className="cat-row__main">
                <p className="cat-row__title">{promotion.title}</p>
                <p className="cat-row__meta">{promotion.subtitle ?? '—'}</p>
                <p className="cat-row__meta">
                  {promotion.cta_label
                    ? `${promotion.cta_label} → ${describePromotionTarget(promotion)}`
                    : // A full-artwork banner can point somewhere with no button:
                      // the whole card is the tap target, so it is not informational.
                      promotion.cta_destination_type
                      ? `Whole card → ${describePromotionTarget(promotion)}`
                      : 'Informational'}
                </p>
                <div className="cat-row__badges">
                  <Badge tone={promotion.is_active ? 'active' : 'inactive'}>{promotion.is_active ? 'Live' : 'Hidden'}</Badge>
                  <span className="cat-row__order">Order {promotion.display_order}</span>
                </div>
              </div>
              <div className="cat-row__actions">
                <div className="order-cell">
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Move ${promotion.title} up`}
                    disabled={index === 0}
                    onClick={() => void move(promotion, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    aria-label={`Move ${promotion.title} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => void move(promotion, 1)}
                  >
                    ↓
                  </button>
                </div>
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(promotion)}>
                  Edit
                </button>
                <button type="button" className="button button--ghost button--sm" onClick={() => void toggleActive(promotion)}>
                  {promotion.is_active ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="button button--ghost button--sm" onClick={() => setPendingDelete(promotion)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <PromotionDialog
          promotion={editing === 'new' ? null : editing}
          allRows={rows ?? []}
          categories={categories}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete promotion"
          message={`"${pendingDelete.title}" will be removed permanently, along with its uploaded images.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * "What customers see now" - `GET /promotions` (public), the exact payload
 * the customer Home carousel receives, distinct from the per-row/per-edit
 * draft preview above (which renders local, unsaved form state). Real data
 * only: if the call fails, the strip is simply omitted rather than showing
 * a stale or fabricated view (common.md rule 7).
 *
 * 2026-10-14 (owner: "make sure promotional banner edit option like this
 * animation in the ops and admin"): the cards are still listed, and "Watch
 * the carousel" plays them in a phone at the app's real size, moving exactly
 * as the new customer app's carousel moves (docs/promo-surfaces.md).
 */
function LivePreviewStrip() {
  const [live, setLive] = useState<Promotion[] | null>(null);
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    void catalog.promotions
      .listPublic()
      .then(setLive)
      .catch(() => setLive([]));
  }, []);

  if (!live || live.length === 0) return null;

  return (
    <section className="promo-live" aria-label="What customers see now">
      <h2 className="section-label">What customers see now</h2>
      <button
        type="button"
        className="button button--ghost button--sm"
        aria-expanded={watching}
        onClick={() => setWatching((w) => !w)}
      >
        {watching ? 'Hide carousel preview' : 'Watch the carousel'}
      </button>
      {watching ? (
        <div className="carousel-strip">
          <PromoCarouselPreview promotions={live} label="The Home carousel, as customers see it" />
        </div>
      ) : null}
      <div className="promo-live__row">
        {live.map((promotion) => (
          <div key={promotion.id} className="promo-live__item">
            <PromotionPreview promotion={promotion} />
          </div>
        ))}
      </div>
    </section>
  );
}

// New promotions start as a designed banner - one finished picture, like the
// big shopping apps (owner, 2026-10-08). The other types are one tap away.
const EMPTY_BACKGROUND: BackgroundValue = {
  background_type: 'ARTWORK',
  background_color: SOLID_SWATCHES[1]!.value,
  background_color_end: null,
  background_image_url: null,
  // The centre - the crop every card already had before migration 009.
  background_focal_x: 50,
  background_focal_y: 50,
};

function PromotionDialog({
  promotion,
  allRows,
  categories,
  groups,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null;
  /** Every promotion, for the whole-carousel preview. */
  allRows: Promotion[];
  categories: Category[];
  groups: CategoryGroup[];
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [title, setTitle] = useState(promotion?.title ?? '');
  const [subtitle, setSubtitle] = useState(promotion?.subtitle ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(promotion?.image_url ?? null);
  const [background, setBackground] = useState<BackgroundValue>(
    promotion
      ? {
          background_type: promotion.background_type ?? 'SOLID',
          background_color: promotion.background_color,
          background_color_end: promotion.background_color_end,
          background_image_url: promotion.background_image_url,
          // A promotion saved before 009 carries no focal point; the centre
          // is both the column default and the crop it already had.
          background_focal_x: promotion.background_focal_x ?? 50,
          background_focal_y: promotion.background_focal_y ?? 50,
        }
      : EMPTY_BACKGROUND
  );
  const [ctaLabel, setCtaLabel] = useState(promotion?.cta_label ?? '');
  // The picker's kind: the stored type, except CATALOG + a group id = 'MAIN'.
  const [targetKind, setTargetKind] = useState<TargetKind>(() => initialTargetKind(promotion));
  const [destinationValue, setDestinationValue] = useState(promotion?.cta_destination_value ?? '');
  /** The chosen product's name, for the picker (the stored value is only its id). */
  const [productName, setProductName] = useState<string | null>(
    promotion?.cta_target?.level === 'PRODUCT' ? promotion.cta_target.name : null
  );
  const destinationType = targetKind === 'MAIN' ? 'CATALOG' : targetKind;
  const pickerCategories = useMemo(() => categoryOptions(categories), [categories]);
  const [displayOrder, setDisplayOrder] = useState(String(promotion?.display_order ?? 0));
  const [isActive, setIsActive] = useState(promotion?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  // Live preview: this slide on its own, or in its place in the carousel.
  const [previewAll, setPreviewAll] = useState(false);

  const isArtwork = background.background_type === 'ARTWORK';

  const draft: Promotion = {
    id: promotion?.id ?? 'draft',
    title: title || 'Promotion headline',
    subtitle: subtitle || null,
    image_url: imageUrl,
    background_type: background.background_type,
    background_color: background.background_color,
    background_color_end: background.background_color_end,
    background_image_url: background.background_image_url,
    background_focal_x: background.background_focal_x,
    background_focal_y: background.background_focal_y,
    cta_label: ctaLabel || null,
    cta_destination_type: (destinationType || null) as Promotion['cta_destination_type'],
    cta_destination_value: destinationValue || null,
    display_order: Number(displayOrder) || 0,
    is_active: isActive,
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOrderError(null);

    // Checked here so the operator sees which field is wrong, not the API's 400.
    const order = parseDisplayOrder(displayOrder, MAX_PROMOTION_ORDER);
    if ('error' in order) {
      setOrderError(order.error);
      return;
    }

    if (title.trim().length < 2) {
      setError('Title must be at least 2 characters.');
      return;
    }
    // ARTWORK is the one type that may point somewhere with no button label:
    // the banner draws its own call to action and the whole card becomes the
    // tap target. Every other type still needs a label to have anything to
    // press.
    if (destinationType && !ctaLabel.trim() && !isArtwork) {
      setError('A promotion with a destination needs a button label.');
      return;
    }
    if ((targetKind === 'CATEGORY' || targetKind === 'PRODUCT' || targetKind === 'MAIN') && !destinationValue.trim()) {
      setError(
        targetKind === 'MAIN'
          ? 'Choose the main section.'
          : targetKind === 'PRODUCT'
            ? 'Choose the product.'
            : 'Choose the category or sub-category.'
      );
      return;
    }
    if (usesBackgroundImage(background.background_type) && !background.background_image_url) {
      setError(
        isArtwork
          ? 'Upload the banner artwork, or choose another background type.'
          : 'Upload a background image, or choose a solid or gradient background.'
      );
      return;
    }
    if (background.background_type === 'GRADIENT' && !(background.background_color && background.background_color_end)) {
      setError('Pick a gradient.');
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      image_url: imageUrl,
      background_type: background.background_type,
      background_color: usesBackgroundImage(background.background_type) ? null : background.background_color,
      background_color_end: background.background_type === 'GRADIENT' ? background.background_color_end : null,
      background_image_url: usesBackgroundImage(background.background_type) ? background.background_image_url : null,
      // The focal point only means anything for the two types that draw a
      // file; a solid or gradient card sends the centre, which is a no-op.
      background_focal_x: usesBackgroundImage(background.background_type) ? background.background_focal_x : 50,
      background_focal_y: usesBackgroundImage(background.background_type) ? background.background_focal_y : 50,
      cta_label: ctaLabel.trim() || null,
      cta_destination_type: destinationType || null,
      cta_destination_value: targetKind === 'CATALOG' || targetKind === '' ? null : destinationValue.trim(),
      display_order: order.value,
      is_active: isActive,
    };

    setSaving(true);
    try {
      if (promotion) {
        await catalog.promotions.update(promotion.id, payload);
      } else {
        await catalog.promotions.create(payload);
      }
      // Saved: only now are the replaced (or removed) files safe to delete.
      void deleteImagesQuietly(
        replacedImages(
          [promotion?.image_url, promotion?.background_image_url],
          [payload.image_url as string | null, payload.background_image_url as string | null]
        )
      );
      await onSaved();
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Promotion">
      <form className="modal__panel modal__panel--wide" onSubmit={submit}>
        <h2 className="modal__title">{promotion ? 'Edit promotion' : 'Add promotion'}</h2>

        <section className="editor__section">
          <h3 className="editor__legend">Content</h3>
          {/*
            On a full-artwork card nothing is drawn over the banner, so calling
            this field "Headline" made a required field look pointless — the
            operator can see there is no headline on the card. It is not a
            headline there; it is the promotion's NAME, and it is load-bearing
            in six places: the row in this list, the reorder buttons' labels,
            the delete confirmation, the live/hidden notice, and the label a
            screen reader announces for the slide (without which the promotion
            is invisible to those customers, because its words are pixels).
            So the requirement stays and the label tells the truth instead.
          */}
          <Field
            label={isArtwork ? 'Banner name' : 'Headline'}
            hint={
              isArtwork
                ? 'Not shown on the banner — your artwork already carries its own wording. This names the promotion here, and is what a screen reader reads out to customers.'
                : 'The loudest line on the card'
            }
          >
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field
            label="Supporting text"
            hint={isArtwork ? 'Not drawn on a full-artwork card' : 'Optional second line'}
          >
            <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
          </Field>
          <div className="form__row">
            <Field
              label="Button label"
              hint={
                isArtwork
                  ? 'Optional here: with a label a button is drawn over the artwork; leave it blank and the whole banner becomes tappable, opening the destination below'
                  : 'Leave blank for an informational promotion'
              }
            >
              <input className="input" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
            </Field>
            {/*
              This is the difference between a banner that sells something and
              a poster. Left as "Nothing", tapping the banner in the customer
              app does nothing at all — which reads as broken to a shopper, not
              as informational. The label and hint now say where the tap lands
              so it is a deliberate choice rather than a default nobody noticed.
            */}
            <Field
              label={isArtwork ? 'Tapping the banner opens' : 'Button goes to'}
              hint={
                destinationType
                  ? undefined
                  : 'Nothing happens when a customer taps it. Pick a category to send them to what the banner is advertising.'
              }
            >
              <select
                className="input"
                value={targetKind}
                onChange={(e) => {
                  setTargetKind(e.target.value as TargetKind);
                  setDestinationValue('');
                  setProductName(null);
                }}
              >
                <option value="">Nothing (informational)</option>
                <option value="CATALOG">Whole catalog</option>
                <option value="MAIN">A main section (home heading)</option>
                <option value="CATEGORY">A category or sub-category</option>
                <option value="PRODUCT">A product</option>
              </select>
            </Field>
          </div>

          {targetKind === 'MAIN' ? (
            <Field label="Main section" hint="The heading on the customer home, e.g. Grocery">
              <select className="input" value={destinationValue} onChange={(e) => setDestinationValue(e.target.value)}>
                <option value="">Select a main section</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.is_active ? '' : ' (off)'}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {targetKind === 'CATEGORY' ? (
            <Field label="Category or sub-category" hint="Sub-categories are the sidebar items inside a category">
              <select className="input" value={destinationValue} onChange={(e) => setDestinationValue(e.target.value)}>
                <option value="">Select a category</option>
                {pickerCategories.map((option) => (
                  <option key={option.id} value={option.slug}>
                    {option.label}
                    {option.isActive ? '' : ' (off)'}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {targetKind === 'PRODUCT' ? (
            <TargetProductPicker
              selectedId={destinationValue || null}
              selectedName={productName}
              onPick={(product) => {
                setDestinationValue(product?.id ?? '');
                setProductName(product?.name ?? null);
              }}
            />
          ) : null}
        </section>

        {/* A designed banner draws only its own picture: no product cut-out. */}
        {isArtwork ? null : (
          <section className="editor__section">
            <h3 className="editor__legend">Foreground visual</h3>
            <ImageUploader value={imageUrl} folder="promotions" label="Product or promotional image" onChange={setImageUrl} />
          </section>
        )}

        <section className="editor__section">
          <h3 className="editor__legend">Background</h3>
          <BackgroundPicker value={background} onChange={setBackground} />
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Customer preview</h3>
          <div className="preview-controls" role="group" aria-label="Preview">
            <button
              type="button"
              className="button button--ghost button--sm"
              aria-pressed={!previewAll}
              onClick={() => setPreviewAll(false)}
            >
              This slide
            </button>
            <button
              type="button"
              className="button button--ghost button--sm"
              aria-pressed={previewAll}
              onClick={() => setPreviewAll(true)}
            >
              Whole carousel
            </button>
          </div>
          {/* Plays in the app's phone size, moving as the carousel moves; updates as you type. */}
          <PromoCarouselPreview
            promotions={previewAll ? carouselWithDraft(allRows, draft) : [draft]}
            focusId={draft.id}
            loopSingle={!previewAll}
            label="This promotion in the customer app"
          />
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Settings</h3>
          <div className="form__row">
            <Field label="Display order" hint="Lower numbers appear first (0-1000)" error={orderError ?? undefined}>
              <input
                className="input"
                inputMode="numeric"
                value={displayOrder}
                aria-invalid={orderError ? true : undefined}
                onChange={(e) => {
                  setDisplayOrder(e.target.value);
                  setOrderError(null);
                }}
              />
            </Field>
            <label className="toggle">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span>
                <strong>Active</strong>
                <em>Only active promotions reach the customer app.</em>
              </span>
            </label>
          </div>
        </section>

        {error ? <p className="field__error">{error}</p> : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

type TargetKind = '' | 'CATALOG' | 'MAIN' | 'CATEGORY' | 'PRODUCT';

function initialTargetKind(promotion: Promotion | null): TargetKind {
  const type = promotion?.cta_destination_type ?? null;
  if (!type) return '';
  if (type === 'CATALOG') return promotion?.cta_destination_value ? 'MAIN' : 'CATALOG';
  return type;
}

/**
 * The banner's product: search `GET /admin/products?search=` (a short pause
 * after typing) and pick one. Switched-off products are listed too - a
 * banner can be prepared before the product goes live.
 */
export function TargetProductPicker({
  selectedId,
  selectedName,
  onPick,
}: {
  selectedId: string | null;
  selectedName: string | null;
  onPick(product: AdminProduct | null): void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        .list({ search: term, limit: 20 })
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

  if (selectedId) {
    return (
      <div className="field">
        <span className="field__label">Product</span>
        <p className="card__row">
          <span className="card__value">{selectedName ?? `Product ${selectedId}`}</span>
          <button type="button" className="button button--ghost button--sm" onClick={() => onPick(null)}>
            Change
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="combo-search">
      <Field label="Find the product" hint="Type at least 2 letters of its name or SKU">
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
        <ul className="combo-search__results" aria-label="Product results">
          {results.map((product) => (
            <li key={product.id} className="combo-search__row">
              <span className="combo-search__name">
                {product.name}
                <span className="cat-row__meta">
                  {[product.unit, product.sku, product.is_active ? null : 'off'].filter(Boolean).join(' · ')}
                </span>
              </span>
              <button
                type="button"
                className="button button--ghost button--sm"
                aria-label={`Choose ${product.name}`}
                onClick={() => onPick(product)}
              >
                Choose
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
