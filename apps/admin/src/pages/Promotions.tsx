import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  categories as categoriesApi,
  categoryGroups as groupsApi,
  products as productsApi,
  promotions as promotionsApi,
} from '../api/resources';
import type { AdminProduct, Category, CategoryGroup, Promotion } from '../api/types';
import { categoryOptions, SUB_CATEGORY_SEPARATOR } from '../lib/categoryTree';
import {
  BackgroundPicker,
  GRADIENT_PRESETS,
  SOLID_SWATCHES,
  usesBackgroundImage,
  type BackgroundValue,
} from '../components/BackgroundPicker';
import { errorMessage } from '../lib/apiErrors';
import { useImageCleanup } from '../lib/imageCleanup';
import { ImageUploader } from '../components/ImageUploader';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { PromotionPreview } from '../components/PromotionPreview';

/**
 * Home promotions: the carousel at the top of the customer app.
 *
 * This screen is the only source of that content - the Flutter app renders
 * whatever the promotions API returns, in the order set here, with the
 * background chosen here.
 */
export function Promotions() {
  const toast = useToast();
  const [rows, setRows] = useState<Promotion[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // Main sections (category groups) for the "Main section" destination.
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Promotion | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await promotionsApi.listAdmin());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load promotions.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void categoriesApi.listAdmin().then(setCategories).catch(() => setCategories([]));
    void groupsApi
      .list()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, [load]);

  async function toggleActive(promotion: Promotion) {
    try {
      await promotionsApi.update(promotion.id, { is_active: !promotion.is_active });
      toast.success(
        `${promotion.title} is now ${promotion.is_active ? 'hidden from' : 'live on'} Home.`
      );
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the promotion.'));
    }
  }

  /** Swaps with the neighbour (normalising equal orders first), then persists. */
  async function move(promotion: Promotion, direction: -1 | 1) {
    if (!rows) return;
    const items = reorderItems(rows, promotion.id, direction);
    if (!items) return;

    try {
      await promotionsApi.reorder(items);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reorder.'));
    }
  }

  async function remove(promotion: Promotion) {
    try {
      await promotionsApi.remove(promotion.id);
      toast.success('Promotion deleted.');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the promotion.'));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Home promotions"
        description="Active promotions appear in the customer Home carousel, in this order."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add promotion
          </button>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

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
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col" className="num">Order</th>
              <th scope="col">Card</th>
              <th scope="col">Promotion</th>
              <th scope="col">Background</th>
              <th scope="col">CTA</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((promotion, index) => (
              <tr key={promotion.id}>
                <td className="num">
                  <div className="order-cell">
                    <span>{promotion.display_order}</span>
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
                </td>
                <td>
                  {/* The row shows the real composition, not a thumbnail. */}
                  <PromotionPreview promotion={promotion} compact />
                </td>
                <td>
                  <span className="cell__primary">{promotion.title}</span>
                  <span className="cell__secondary">{promotion.subtitle ?? '—'}</span>
                </td>
                <td className="cell__secondary">{describeBackground(promotion)}</td>
                <td className="cell__secondary">
                  {promotion.cta_label
                    ? `${promotion.cta_label} → ${describeDestination(promotion)}`
                    : promotion.cta_destination_type
                      ? `Whole card → ${describeDestination(promotion)}`
                      : 'Informational'}
                </td>
                <td>
                  <Badge tone={promotion.is_active ? 'active' : 'inactive'}>
                    {promotion.is_active ? 'Live' : 'Hidden'}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setEditing(promotion)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => void toggleActive(promotion)}
                    >
                      {promotion.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setPendingDelete(promotion)}
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

      {editing ? (
        <PromotionDialog
          promotion={editing === 'new' ? null : editing}
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
    </>
  );
}

/**
 * The reorder request for moving one promotion up (-1) or down (1).
 *
 * Normally the two neighbours swap display_order. When they share a value
 * (several promotions saved with the default 0, say) a swap would change
 * nothing, so every promotion is first renumbered 10, 20, 30... in the order
 * shown, then the two swap - the move always takes effect. Null when there
 * is no neighbour that way.
 */
export function reorderItems(
  rows: ReadonlyArray<Pick<Promotion, 'id' | 'display_order'>>,
  id: string,
  direction: -1 | 1
): { id: string; display_order: number }[] | null {
  const index = rows.findIndex((row) => row.id === id);
  const neighbourIndex = index + direction;
  if (index < 0 || neighbourIndex < 0 || neighbourIndex >= rows.length) return null;
  const current = rows[index]!;
  const neighbour = rows[neighbourIndex]!;

  if (current.display_order !== neighbour.display_order) {
    return [
      { id: current.id, display_order: neighbour.display_order },
      { id: neighbour.id, display_order: current.display_order },
    ];
  }

  // The API caps display_order at 1000 (and a reorder at 100 items).
  const step = Math.max(1, Math.min(10, Math.floor(1000 / rows.length)));
  const normalised = rows.map((row, i) => ({ id: row.id, display_order: (i + 1) * step }));
  const moved = normalised[index]!.display_order;
  normalised[index]!.display_order = normalised[neighbourIndex]!.display_order;
  normalised[neighbourIndex]!.display_order = moved;
  return normalised;
}

/**
 * Where the banner goes, from the server's resolved `cta_target` (owner,
 * 2026-10-14): "Sub-category: Rice & Flour › Rice", "Main: Grocery"...
 * null with a destination type = the target no longer exists. An older API
 * without cta_target falls back to the stored type and value.
 */
export function describeDestination(promotion: Promotion): string {
  const target = promotion.cta_target;
  if (target !== undefined) {
    if (!promotion.cta_destination_type) return 'nothing';
    if (target === null) return 'Target missing';
    const off = target.is_active === false ? ' (off)' : '';
    switch (target.level) {
      case 'MAIN':
        return `Main: ${target.name ?? ''}${off}`;
      case 'CATEGORY':
        return `Category: ${target.name ?? target.slug ?? ''}${off}`;
      case 'SUB_CATEGORY':
        return `Sub-category: ${target.parent_name ? `${target.parent_name}${SUB_CATEGORY_SEPARATOR}` : ''}${
          target.name ?? target.slug ?? ''
        }${off}`;
      case 'PRODUCT':
        return `Product: ${target.name ?? ''}${off}`;
      default:
        return 'Whole catalog';
    }
  }
  switch (promotion.cta_destination_type) {
    case 'CATEGORY':
      return `category "${promotion.cta_destination_value}"`;
    case 'PRODUCT':
      return 'a product';
    case 'CATALOG':
      return 'all products';
    default:
      return 'nothing';
  }
}

function describeBackground(promotion: Promotion): string {
  switch (promotion.background_type) {
    case 'GRADIENT':
      return 'Gradient';
    case 'IMAGE':
      return 'Image';
    case 'ARTWORK':
      return 'Full artwork';
    default:
      return promotion.background_color
        ? namedColour(promotion.background_color)
        : 'Default';
  }
}

function namedColour(hex: string): string {
  const match = SOLID_SWATCHES.find(
    (swatch) => swatch.value.toLowerCase() === hex.toLowerCase()
  );
  return match ? match.label : hex.toUpperCase();
}

// New promotions start as a designed banner - one finished picture
// (owner, 2026-10-08). The other types are one click away.
const EMPTY_BACKGROUND: BackgroundValue = {
  background_type: 'ARTWORK',
  background_color: SOLID_SWATCHES[1]!.value,
  background_color_end: null,
  background_image_url: null,
};

/**
 * The destination picker's choices (owner, 2026-10-14). Stored in the
 * existing columns: ALL = CATALOG + null, MAIN = CATALOG + group id,
 * CATEGORY = CATEGORY + slug (a category or a sub-category), PRODUCT =
 * PRODUCT + product id.
 */
export type TargetKind = '' | 'ALL' | 'MAIN' | 'CATEGORY' | 'PRODUCT';

function initialTarget(promotion: Promotion | null): { kind: TargetKind; value: string } {
  if (!promotion?.cta_destination_type) return { kind: '', value: '' };
  const value = promotion.cta_destination_value ?? '';
  switch (promotion.cta_destination_type) {
    case 'CATALOG':
      return value ? { kind: 'MAIN', value } : { kind: 'ALL', value: '' };
    case 'CATEGORY':
      // The stored value is the slug; an older row may hold an id.
      return { kind: 'CATEGORY', value: promotion.cta_target?.slug ?? value };
    default:
      return { kind: 'PRODUCT', value };
  }
}

const destinationTypeOf = (kind: TargetKind): Promotion['cta_destination_type'] =>
  kind === 'ALL' || kind === 'MAIN' ? 'CATALOG' : kind === 'CATEGORY' ? 'CATEGORY' : kind === 'PRODUCT' ? 'PRODUCT' : null;

function PromotionDialog({
  promotion,
  categories,
  groups,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null;
  categories: Category[];
  groups: CategoryGroup[];
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const toast = useToast();
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
        }
      : EMPTY_BACKGROUND
  );
  const [ctaLabel, setCtaLabel] = useState(promotion?.cta_label ?? '');
  const [targetKind, setTargetKind] = useState<TargetKind>(() => initialTarget(promotion).kind);
  const [destinationValue, setDestinationValue] = useState(() => initialTarget(promotion).value);
  // PRODUCT: the chosen product's name (the stored value is its id).
  const [productName, setProductName] = useState<string | null>(
    promotion?.cta_target?.level === 'PRODUCT' ? promotion.cta_target.name : null
  );
  const destinationType = destinationTypeOf(targetKind);
  const [displayOrder, setDisplayOrder] = useState(String(promotion?.display_order ?? 0));
  const [isActive, setIsActive] = useState(promotion?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Files the saved promotion points at; replaced ones go only after a save.
  const images = useImageCleanup([promotion?.image_url, promotion?.background_image_url]);
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
    background_focal_x: promotion?.background_focal_x,
    background_focal_y: promotion?.background_focal_y,
    cta_label: ctaLabel || null,
    cta_destination_type: destinationType,
    cta_destination_value: destinationValue || null,
    display_order: Number(displayOrder) || 0,
    is_active: isActive,
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (title.trim().length < 2) {
      setError('Title must be at least 2 characters.');
      return;
    }
    // ARTWORK may point somewhere with no label: the whole card is the button.
    if (destinationType && !ctaLabel.trim() && !isArtwork) {
      setError('A promotion with a destination needs a button label.');
      return;
    }
    if ((targetKind === 'MAIN' || targetKind === 'CATEGORY' || targetKind === 'PRODUCT') && !destinationValue.trim()) {
      setError(
        targetKind === 'MAIN'
          ? 'Choose the main section the banner opens.'
          : targetKind === 'CATEGORY'
            ? 'Choose the category or sub-category the banner opens.'
            : 'Choose the product the banner opens.'
      );
      return;
    }
    if (background.background_type === 'IMAGE' && !background.background_image_url) {
      setError('Upload a background image, or choose a solid or gradient background.');
      return;
    }
    if (isArtwork && !background.background_image_url) {
      setError('Upload the banner artwork, or choose another background.');
      return;
    }
    if (
      background.background_type === 'GRADIENT' &&
      !(background.background_color && background.background_color_end)
    ) {
      setError('Pick a gradient.');
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      image_url: imageUrl,
      background_type: background.background_type,
      background_color: usesBackgroundImage(background.background_type) ? null : background.background_color,
      background_color_end:
        background.background_type === 'GRADIENT' ? background.background_color_end : null,
      // IMAGE and ARTWORK both carry the file; nulling it for ARTWORK is a 400.
      background_image_url: usesBackgroundImage(background.background_type)
        ? background.background_image_url
        : null,
      cta_label: ctaLabel.trim() || null,
      cta_destination_type: destinationType,
      cta_destination_value: targetKind === 'ALL' || targetKind === '' ? null : destinationValue.trim(),
      display_order: Number(displayOrder) || 0,
      is_active: isActive,
    };

    setSaving(true);
    try {
      if (promotion) {
        await promotionsApi.update(promotion.id, payload);
        toast.success('Promotion updated.');
      } else {
        await promotionsApi.create(payload);
        toast.success('Promotion created.');
      }
      // Saved: files it no longer uses (removed, replaced, or a background
      // switched away from an image) can be deleted now.
      await images.afterSave([payload.image_url as string | null, payload.background_image_url as string | null]);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the promotion.'));
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
          <Field
            label="Headline"
            hint={
              isArtwork
                ? 'Not drawn on full artwork, but required: screen readers announce it and staff lists show it'
                : 'The loudest line on the card'
            }
          >
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Supporting text" hint="Optional second line">
            <input
              className="input"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </Field>
          <div className="form__row">
            <Field
              label="Button label"
              hint={
                isArtwork
                  ? 'Optional on full artwork: with no label the whole card opens the destination'
                  : 'Leave blank for an informational promotion'
              }
            >
              <input
                className="input"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
              />
            </Field>
            <Field label="Button goes to">
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
                <option value="ALL">Whole catalog (all products)</option>
                <option value="MAIN">A main section (home heading)</option>
                <option value="CATEGORY">A category or sub-category</option>
                <option value="PRODUCT">A product</option>
              </select>
            </Field>
          </div>

          {targetKind === 'MAIN' ? (
            <Field label="Main section" hint="Opens the catalog at this home section">
              <select
                className="input"
                value={destinationValue}
                onChange={(e) => setDestinationValue(e.target.value)}
              >
                <option value="">Select a main section</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.is_active ? '' : ' (hidden)'}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {targetKind === 'CATEGORY' ? (
            <Field
              label="Category or sub-category"
              hint="A sub-category opens its category with that sidebar item selected"
            >
              <select
                className="input"
                value={destinationValue}
                onChange={(e) => setDestinationValue(e.target.value)}
              >
                <option value="">Select a category</option>
                {categoryOptions(categories).map(({ category, label }) => (
                  <option key={category.id} value={category.slug}>
                    {label}
                    {category.is_active ? '' : ' (off)'}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {targetKind === 'PRODUCT' ? (
            <ProductPicker
              value={destinationValue}
              name={productName}
              onChange={(id, name) => {
                setDestinationValue(id);
                setProductName(name);
              }}
            />
          ) : null}
        </section>

        {/* A designed banner draws only its own picture: no product cut-out. */}
        {isArtwork ? null : (
          <section className="editor__section">
            <h3 className="editor__legend">Foreground visual</h3>
            <ImageUploader
              value={imageUrl}
              folder="promotions"
              label="Product or promotional image"
              onChange={(url) => {
                images.track(url);
                setImageUrl(url);
              }}
            />
          </section>
        )}

        <section className="editor__section">
          <h3 className="editor__legend">Background</h3>
          <BackgroundPicker
            value={background}
            onChange={(next) => {
              images.track(next.background_image_url);
              setBackground(next);
            }}
          />
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Customer preview</h3>
          <PromotionPreview promotion={draft} />
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Settings</h3>
          <div className="form__row">
            <Field label="Display order" hint="Lower numbers appear first">
              <input
                className="input"
                inputMode="numeric"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
              />
            </Field>
            <label className="toggle">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
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

export { GRADIENT_PRESETS };

/**
 * Searchable product picker for a PRODUCT destination: type part of a name,
 * SKU or barcode (GET /admin/products?search=) and choose a result.
 */
function ProductPicker({
  value,
  name,
  onChange,
}: {
  value: string;
  name: string | null;
  onChange(id: string, name: string | null): void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AdminProduct[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      productsApi
        .searchAdmin(term)
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
          setSearchError(null);
        })
        .catch((err) => {
          if (!cancelled) setSearchError(errorMessage(err, 'Could not search products.'));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <div className="field">
      <span className="field__label">Product</span>
      <span className="field__hint" aria-live="polite">
        {value ? `Selected: ${name ?? value}` : 'No product selected yet'}
      </span>
      <input
        className="input"
        type="search"
        aria-label="Search products"
        placeholder="Search by name, SKU or barcode"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {searchError ? <span className="field__error">{searchError}</span> : null}
      {results === null ? null : results.length === 0 ? (
        <span className="field__hint">No products match.</span>
      ) : (
        <ul className="picker-results" aria-label="Matching products">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="button button--ghost button--sm"
                aria-pressed={product.id === value}
                onClick={() => onChange(product.id, product.name)}
              >
                {product.name}
                {product.category_name ? ` · ${product.category_name}` : ''}
                {product.is_active ? '' : ' (off)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
