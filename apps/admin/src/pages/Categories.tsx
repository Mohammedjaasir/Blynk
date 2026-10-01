import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { categories as categoriesApi } from '../api/resources';
import type { Category } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, Field, Spinner, useToast } from '../components/ui';

/**
 * Categories: create, edit, activate/deactivate and delete.
 *
 * Deleting a category that still has products needs somewhere to move them:
 * the API refuses (409 CATEGORY_NOT_EMPTY) without a target, so the dialog
 * asks for one up front using the list's product_count.
 */
export function Categories() {
  const toast = useToast();
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await categoriesApi.listAdmin());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load categories.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(category: Category) {
    try {
      await categoriesApi.update(category.id, { is_active: !category.is_active });
      toast.success(
        `${category.name} is now ${category.is_active ? 'inactive' : 'active'}.`
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the category.');
    }
  }

  return (
    <>
      <PageHeader
        title="Categories"
        description="Used by the customer Home, Categories and Search screens."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add category
          </button>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading categories" />
      ) : (
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Slug</th>
              <th scope="col">Description</th>
              <th scope="col" className="num">Order</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((category) => (
              <tr key={category.id}>
                <td className="cell__primary">{category.name}</td>
                <td className="cell__secondary">{category.slug}</td>
                <td className="cell__secondary">{category.description ?? '-'}</td>
                <td className="num">{category.display_order}</td>
                <td>
                  <Badge tone={category.is_active ? 'active' : 'inactive'}>
                    {category.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setEditing(category)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => void toggleActive(category)}
                    >
                      {category.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setDeleting(category)}
                      aria-label={`Delete ${category.name}`}
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

      <p className="form__note">
        Deactivate a category to hide it for a while; delete it to retire it
        for good (its products move to another category first).
      </p>

      {deleting && rows ? (
        <DeleteCategoryDialog
          category={deleting}
          others={rows.filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await load();
          }}
        />
      ) : null}

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
    </>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
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
        display_order: Number(displayOrder) || 0,
        is_active: isActive,
      };
      if (category) {
        await categoriesApi.update(category.id, payload);
        toast.success('Category updated.');
      } else {
        await categoriesApi.create(payload);
        toast.success('Category created.');
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the category.');
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
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Display order">
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

/**
 * Plain confirm for an empty category; with products, a "Move its N
 * products to:" select that must be filled before Delete is enabled. A 409
 * CATEGORY_NOT_EMPTY (the count was stale) switches the dialog to the move
 * form using the server's details.product_count.
 */
function DeleteCategoryDialog({
  category,
  others,
  onClose,
  onDeleted,
}: {
  category: Category;
  others: Category[];
  onClose(): void;
  onDeleted(): void | Promise<void>;
}) {
  const toast = useToast();
  const [productCount, setProductCount] = useState(category.product_count ?? 0);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsTarget = productCount > 0;

  async function confirm() {
    if (busy || (needsTarget && !target)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await categoriesApi.remove(category.id, needsTarget ? target : undefined);
      const moved = result.moved_product_count;
      const targetName = others.find((c) => c.id === target)?.name;
      toast.success(
        moved > 0 && targetName
          ? `${category.name} is deleted. ${moved} ${moved === 1 ? 'product' : 'products'} moved to ${targetName}.`
          : `${category.name} is deleted.`
      );
      await onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CATEGORY_NOT_EMPTY') {
        const count = Number((err.details as { product_count?: number } | undefined)?.product_count ?? 0);
        setProductCount(count > 0 ? count : 1);
        setError('This category has products. Choose where to move them first.');
      } else if (err instanceof ApiError && err.code === 'INVALID_MOVE_TARGET') {
        setTarget('');
        setError('That category can no longer take these products. Choose another one.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not delete the category.');
      }
    } finally {
      setBusy(false);
    }
  }

  const noun = productCount === 1 ? 'product' : 'products';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Delete category">
      <div className="modal__panel">
        <h2 className="modal__title">Delete category</h2>
        <p className="modal__message">{`Delete ${category.name}? Customers will no longer see it.`}</p>
        {needsTarget ? (
          others.length > 0 ? (
            <Field label={`Move its ${productCount} ${noun} to:`}>
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a category</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="field__error">
              It has {productCount} {noun} and there is no other category to move them to. Add one first.
            </p>
          )
        ) : null}
        {error ? <p className="field__error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={busy || (needsTarget && !target)}
            onClick={() => void confirm()}
          >
            {busy ? <Spinner label="Deleting" /> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
