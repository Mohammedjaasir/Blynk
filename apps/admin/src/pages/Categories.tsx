import { errorMessage } from '../lib/apiErrors';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { categories as categoriesApi, categoryGroups as groupsApi } from '../api/resources';
import type { Category, CategoryGroup } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, Field, Spinner, useToast } from '../components/ui';
import { endOfDay, validateCategoryOffer } from '../lib/combos';
import { colomboDate, formatDay } from '../lib/coupons';

/**
 * Categories: create, edit, activate/deactivate and delete.
 *
 * Deleting a category that still has products needs somewhere to move them:
 * the API refuses (409 CATEGORY_NOT_EMPTY) without a target, so the dialog
 * asks for one up front using the list's product_count.
 *
 * Sub-categories (one level): a category can sit inside a top-level one
 * ("Bread" in "Bakery"). The list shows each child right under its parent.
 */
export function Categories() {
  const toast = useToast();
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  // Category offer (owner, 2026-10-09).
  const [offering, setOffering] = useState<Category | null>(null);
  // For the edit form's Group select; without category groups on the API
  // the select just offers "None".
  const [groups, setGroups] = useState<CategoryGroup[]>([]);

  const load = useCallback(async () => {
    try {
      setRows(await categoriesApi.listAdmin());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load categories.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    groupsApi
      .list()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
  }, [load]);

  async function toggleActive(category: Category) {
    try {
      await categoriesApi.update(category.id, { is_active: !category.is_active });
      toast.success(
        `${category.name} is now ${category.is_active ? 'inactive' : 'active'}.`
      );
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the category.'));
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
            {nestedRows(rows).map(({ category, parent }) => (
              <tr key={category.id} className={parent ? 'row--child' : undefined}>
                <td className="cell__primary">
                  {parent ? (
                    <>
                      <span aria-hidden="true">{'↳ '}</span>
                      {category.name}
                      <span className="cell__note">{` in ${parent.name}`}</span>
                    </>
                  ) : (
                    category.name
                  )}
                </td>
                <td className="cell__secondary">{category.slug}</td>
                <td className="cell__secondary">{category.description ?? '-'}</td>
                <td className="num">{category.display_order}</td>
                <td>
                  <Badge tone={category.is_active ? 'active' : 'inactive'}>
                    {category.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  {/* Category offer, while it runs (owner, 2026-10-09). */}
                  {category.offer_active && category.offer_percent != null ? (
                    <span className="cell__secondary">
                      <Badge tone="offer">{`${category.offer_percent}% off`}</Badge>
                    </span>
                  ) : null}
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
                      onClick={() => setOffering(category)}
                      aria-label={`Offer for ${category.name}`}
                    >
                      Offer
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

      {offering ? (
        <CategoryOfferDialog
          category={offering}
          subCategories={(rows ?? []).filter((c) => c.parent_id === offering.id)}
          onClose={() => setOffering(null)}
          onSaved={async () => {
            setOffering(null);
            await load();
          }}
        />
      ) : null}

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          groups={groups}
          categories={rows ?? []}
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

/**
 * Top-level categories in list order, each followed by its sub-categories.
 * A child whose parent is not in the list shows as top level.
 */
export function nestedRows(rows: Category[]): Array<{ category: Category; parent: Category | null }> {
  const byId = new Map(rows.map((c) => [c.id, c]));
  const out: Array<{ category: Category; parent: Category | null }> = [];
  for (const category of rows) {
    if (category.parent_id && byId.has(category.parent_id)) continue;
    out.push({ category, parent: null });
    for (const child of rows) {
      if (child.parent_id === category.id) out.push({ category: child, parent: category });
    }
  }
  return out;
}

function CategoryDialog({
  category,
  groups,
  categories,
  onClose,
  onSaved,
}: {
  category: Category | null;
  groups: CategoryGroup[];
  /** Every category, for the "Inside category" select. */
  categories: Category[];
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(category?.display_order ?? 0));
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const initialGroupId = category?.group_id ?? '';
  const [groupId, setGroupId] = useState(initialGroupId);
  const initialParentId = category?.parent_id ?? '';
  const [parentId, setParentId] = useState(initialParentId);
  // One level only: a parent must be top level and not this category, and a
  // category that already has sub-categories stays top level.
  const parentOptions = categories.filter((c) => !c.parent_id && c.id !== category?.id);
  const hasChildren = category ? categories.some((c) => c.parent_id === category.id) : false;
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
      const payload: Partial<Category> = {
        name: name.trim(),
        description: description.trim() || null,
        display_order: Number(displayOrder) || 0,
        is_active: isActive,
      };
      // Only sent when it changed: re-sending the same group would append
      // the category at the end of that group again.
      if (groupId !== initialGroupId) payload.group_id = groupId || null;
      if (parentId !== initialParentId) payload.parent_id = parentId || null;
      if (category) {
        await categoriesApi.update(category.id, payload);
        toast.success('Category updated.');
      } else {
        await categoriesApi.create(payload);
        toast.success('Category created.');
      }
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the category.'));
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
        <Field
          label="Inside category"
          hint={
            hasChildren
              ? 'This category has its own sub-categories, so it stays top level.'
              : 'Makes this a sub-category, listed in that category on the customer app.'
          }
        >
          <select
            className="input"
            value={parentId}
            disabled={hasChildren}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">None (top level)</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {initialParentId && !parentOptions.some((c) => c.id === initialParentId) ? (
              <option value={initialParentId}>Current category</option>
            ) : null}
          </select>
        </Field>
        <Field label="Group">
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            {initialGroupId && !groups.some((g) => g.id === initialGroupId) ? (
              <option value={initialGroupId}>Current group</option>
            ) : null}
          </select>
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
 * Category offer (owner, 2026-10-09): % off everything in the category and
 * its sub-categories, with an optional last day (the offer runs to the end
 * of that day in Colombo). Save replaces any offer; Remove ends it now.
 */
function CategoryOfferDialog({
  category,
  subCategories,
  onClose,
  onSaved,
}: {
  category: Category;
  subCategories: Category[];
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const toast = useToast();
  const stored = category.offer_percent ?? null;
  const storedEndsAt = category.offer_ends_at ?? null;
  const storedEndsOn = storedEndsAt ? colomboDate(storedEndsAt) : '';
  const [percent, setPercent] = useState(stored === null ? '' : String(stored));
  const [endsOn, setEndsOn] = useState(storedEndsOn);
  const [errors, setErrors] = useState<{ percent?: string; endsOn?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(percent.trim());
  const previewOk = percent.trim() !== '' && !validateCategoryOffer(percent, '', '').percent;
  const subNames = subCategories.map((c) => c.name);
  const status =
    stored === null
      ? null
      : category.offer_active
        ? `Running now: ${stored}% off${storedEndsAt ? ` until ${formatDay(storedEndsAt)}` : ''}.`
        : storedEndsAt
          ? `Ended on ${formatDay(storedEndsAt)}. Customers pay the normal prices.`
          : 'Not running.';

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = validateCategoryOffer(percent, endsOn, storedEndsOn);
    setErrors(next);
    if (next.percent || next.endsOn) return;
    setBusy(true);
    setError(null);
    try {
      // An unchanged end day goes back exactly as stored (the API checks
      // only a changed end for being in the past).
      const endsAt = !endsOn ? null : endsOn === storedEndsOn ? storedEndsAt : endOfDay(endsOn);
      await categoriesApi.setOffer(category.id, { offer_percent: value, offer_ends_at: endsAt });
      toast.success(`${value}% off ${category.name} is saved.`);
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OFFER_END_IN_PAST') {
        setErrors({ endsOn: err.message });
      } else {
        setError(errorMessage(err, 'Could not save the offer.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await categoriesApi.removeOffer(category.id);
      toast.success(`The offer on ${category.name} is removed.`);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the offer.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Category offer">
      <form className="modal__panel" onSubmit={save} noValidate>
        <h2 className="modal__title">{`Offer on ${category.name}`}</h2>
        {status ? (
          <p className={`offer-status${category.offer_active ? ' offer-status--running' : ''}`} role="status">
            {status}
          </p>
        ) : null}
        <div className="form__row">
          <Field label="% off" hint="More than 0 and less than 100" error={errors.percent}>
            <input className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
          <Field label="Offer ends" hint="Optional. Runs to the end of this day" error={errors.endsOn}>
            <input
              className="input"
              type="date"
              value={endsOn}
              min={colomboDate()}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </Field>
        </div>
        {previewOk ? (
          <div className="offer-preview">
            <p className="offer-preview__line">
              {`${value}% off everything in ${category.name}`}
              {endsOn ? `, until ${formatDay(endOfDay(endsOn))}` : ''}
            </p>
            {subNames.length > 0 ? (
              <p className="offer-preview__note">{`Also covers its sub-categories: ${subNames.join(', ')}.`}</p>
            ) : null}
            <p className="offer-preview__note">A product with its own lower offer price keeps that price.</p>
          </div>
        ) : null}
        {error ? <p className="field__error">{error}</p> : null}
        <div className="modal__actions">
          {stored !== null ? (
            <button
              type="button"
              className="button button--ink-outline modal__actions-start"
              disabled={busy}
              onClick={() => void remove()}
            >
              Remove offer
            </button>
          ) : null}
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? <Spinner label="Saving" /> : 'Save offer'}
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
        setError(errorMessage(err, 'Could not delete the category.'));
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
