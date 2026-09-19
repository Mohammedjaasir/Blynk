import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { categories as categoriesApi, promotions as promotionsApi } from '../api/resources';
import type { Category, Promotion } from '../api/types';
import {
  BackgroundPicker,
  GRADIENT_PRESETS,
  SOLID_SWATCHES,
  type BackgroundValue,
} from '../components/BackgroundPicker';
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
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Promotion | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await promotionsApi.listAdmin());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load promotions.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void categoriesApi.listAdmin().then(setCategories).catch(() => setCategories([]));
  }, [load]);

  async function toggleActive(promotion: Promotion) {
    try {
      await promotionsApi.update(promotion.id, { is_active: !promotion.is_active });
      toast.success(
        `${promotion.title} is now ${promotion.is_active ? 'hidden from' : 'live on'} Home.`
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the promotion.');
    }
  }

  /** Swaps display_order with the neighbour, then persists both. */
  async function move(promotion: Promotion, direction: -1 | 1) {
    if (!rows) return;
    const index = rows.findIndex((row) => row.id === promotion.id);
    const neighbour = rows[index + direction];
    if (!neighbour) return;

    try {
      await promotionsApi.reorder([
        { id: promotion.id, display_order: neighbour.display_order },
        { id: neighbour.id, display_order: promotion.display_order },
      ]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder.');
    }
  }

  async function remove(promotion: Promotion) {
    try {
      await promotionsApi.remove(promotion.id);
      toast.success('Promotion deleted.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the promotion.');
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

function describeDestination(promotion: Promotion): string {
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

const EMPTY_BACKGROUND: BackgroundValue = {
  background_type: 'SOLID',
  background_color: SOLID_SWATCHES[1]!.value,
  background_color_end: null,
  background_image_url: null,
};

function PromotionDialog({
  promotion,
  categories,
  onClose,
  onSaved,
}: {
  promotion: Promotion | null;
  categories: Category[];
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
  const [destinationType, setDestinationType] = useState<string>(
    promotion?.cta_destination_type ?? ''
  );
  const [destinationValue, setDestinationValue] = useState(
    promotion?.cta_destination_value ?? ''
  );
  const [displayOrder, setDisplayOrder] = useState(String(promotion?.display_order ?? 0));
  const [isActive, setIsActive] = useState(promotion?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: Promotion = {
    id: promotion?.id ?? 'draft',
    title: title || 'Promotion headline',
    subtitle: subtitle || null,
    image_url: imageUrl,
    background_type: background.background_type,
    background_color: background.background_color,
    background_color_end: background.background_color_end,
    background_image_url: background.background_image_url,
    cta_label: ctaLabel || null,
    cta_destination_type: (destinationType || null) as Promotion['cta_destination_type'],
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
    if (destinationType && !ctaLabel.trim()) {
      setError('A promotion with a destination needs a button label.');
      return;
    }
    if ((destinationType === 'CATEGORY' || destinationType === 'PRODUCT') && !destinationValue.trim()) {
      setError('Choose where the button should go.');
      return;
    }
    if (background.background_type === 'IMAGE' && !background.background_image_url) {
      setError('Upload a background image, or choose a solid or gradient background.');
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
      background_color:
        background.background_type === 'IMAGE' ? null : background.background_color,
      background_color_end:
        background.background_type === 'GRADIENT' ? background.background_color_end : null,
      background_image_url:
        background.background_type === 'IMAGE' ? background.background_image_url : null,
      cta_label: ctaLabel.trim() || null,
      cta_destination_type: destinationType || null,
      cta_destination_value:
        destinationType === 'CATEGORY' || destinationType === 'PRODUCT'
          ? destinationValue.trim()
          : null,
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
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the promotion.');
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
          <Field label="Headline" hint="The loudest line on the card">
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
            <Field label="Button label" hint="Leave blank for an informational promotion">
              <input
                className="input"
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
              />
            </Field>
            <Field label="Button goes to">
              <select
                className="input"
                value={destinationType}
                onChange={(e) => {
                  setDestinationType(e.target.value);
                  setDestinationValue('');
                }}
              >
                <option value="">Nothing (informational)</option>
                <option value="CATALOG">All products</option>
                <option value="CATEGORY">A category</option>
                <option value="PRODUCT">A product (by id)</option>
              </select>
            </Field>
          </div>

          {destinationType === 'CATEGORY' ? (
            <Field label="Category">
              <select
                className="input"
                value={destinationValue}
                onChange={(e) => setDestinationValue(e.target.value)}
              >
                <option value="">Select a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {destinationType === 'PRODUCT' ? (
            <Field label="Product id" hint="Copy the id from the product list URL">
              <input
                className="input"
                value={destinationValue}
                onChange={(e) => setDestinationValue(e.target.value)}
              />
            </Field>
          ) : null}
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Foreground visual</h3>
          <ImageUploader
            value={imageUrl}
            folder="promotions"
            label="Product or promotional image"
            onChange={setImageUrl}
          />
        </section>

        <section className="editor__section">
          <h3 className="editor__legend">Background</h3>
          <BackgroundPicker value={background} onChange={setBackground} />
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
