import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { catalog } from '../../api/resources';
import type { Category } from '../../api/types';
import { ImageUploader, type FocalPoint } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { Badge, Field, Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';

/**
 * Categories: create, edit and activate/deactivate (task F5). Ported from
 * `apps/admin/src/pages/Categories.tsx` (a fresh implementation, not an
 * import - common.md rule 2).
 *
 * The backend exposes POST and PATCH only - there is no delete endpoint, so
 * this screen doesn't offer one. Deactivating is the supported way to take
 * a category out of the customer app.
 */
export function Categories() {
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await catalog.categories.list());
      setError(null);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(category: Category) {
    try {
      await catalog.categories.update(category.id, { is_active: !category.is_active });
      setNotice(`${category.name} is now ${category.is_active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Categories"
        description="Used by the customer Home, Categories and Search screens."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add category
          </button>
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

      {rows === null ? (
        <Spinner label="Loading categories" />
      ) : (
        <ul className="cat-list">
          {rows.map((category) => (
            <li key={category.id} className="cat-row cat-row--flat">
              {/* The customer app draws this in a CIRCLE, so the row shows it
                  as one too: a picture that looks right in a square preview
                  and loses its subject in a circle is the whole reason to
                  show the real shape here. */}
              <div className="cat-row__thumb cat-row__thumb--circle" aria-hidden="true">
                {category.image_url ? (
                  <img src={category.image_url} alt="" />
                ) : (
                  <span className="cat-row__thumb-empty">No image</span>
                )}
              </div>
              <div className="cat-row__main">
                <p className="cat-row__title">{category.name}</p>
                <p className="cat-row__meta">{category.slug}</p>
                {category.description ? <p className="cat-row__meta">{category.description}</p> : null}
                <div className="cat-row__badges">
                  <Badge tone={category.is_active ? 'active' : 'inactive'}>{category.is_active ? 'Active' : 'Inactive'}</Badge>
                  <span className="cat-row__order">Order {category.display_order}</span>
                </div>
              </div>
              <div className="cat-row__actions">
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(category)}>
                  Edit
                </button>
                <button type="button" className="button button--ghost button--sm" onClick={() => void toggleActive(category)}>
                  {category.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="page__note">The API supports creating and updating categories; it has no delete endpoint, so deactivation is the way to retire one.</p>

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({ category, onClose, onSaved }: { category: Category | null; onClose(): void; onSaved(): void | Promise<void> }) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(category?.image_url ?? null);
  const [focal, setFocal] = useState<FocalPoint>({
    x: category?.image_focal_x ?? 50,
    y: category?.image_focal_y ?? 50,
  });
  const [displayOrder, setDisplayOrder] = useState(String(category?.display_order ?? 0));
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        image_focal_x: focal.x,
        image_focal_y: focal.y,
        display_order: Number(displayOrder) || 0,
        is_active: isActive,
      };
      if (category) {
        await catalog.categories.update(category.id, payload);
      } else {
        await catalog.categories.create(payload);
      }
      await onSaved();
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Category">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">{category ? 'Edit category' : 'Add category'}</h2>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" hint="Shown as the promo subtitle on category slides">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ImageUploader
          value={imageUrl}
          folder="categories"
          label="Category image"
          onChange={setImageUrl}
          focal={focal}
          onFocalChange={setFocal}
          focalShape="circle"
        />
        <p className="field__hint">
          Shown on the customer Home and Categories screens, cropped to a circle.
          Click the part of the image that must stay visible. Without an image,
          the category falls back to its Blynk icon.
        </p>
        <Field label="Display order">
          <input className="input" inputMode="numeric" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
        </Field>
        <label className="toggle">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>
            <strong>Active</strong>
            <em>Inactive categories disappear from the customer app.</em>
          </span>
        </label>
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
