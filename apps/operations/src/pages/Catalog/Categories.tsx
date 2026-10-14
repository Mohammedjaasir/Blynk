import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, deleteImagesQuietly } from '../../api/client';
import { catalog, settings } from '../../api/resources';
import type { Category, CategoryGroup } from '../../api/types';
import { ImageUploader, type FocalPoint } from '../../components/ImageUploader';
import { PageHeader } from '../../components/Layout';
import { Badge, Field, Spinner } from '../../components/ui';
import {
  catalogErrorMessage,
  colomboDay,
  colomboTodayDay,
  formatColomboDate,
  offerEndForDay,
  offerPercentLabel,
  parseDisplayOrder,
  parseOfferPercent,
} from '../../lib/catalog';
import { replacedImages } from '../../lib/image';
import { inheritedMarkup, markupProductCountText, parseMarkupPercent, percentText } from '../../lib/pricing';

/**
 * Categories: create, edit and activate/deactivate (task F5). Ported from
 * `apps/admin/src/pages/Categories.tsx` (a fresh implementation, not an
 * import - common.md rule 2).
 *
 * Delete (`DELETE /admin/categories/:id`): an empty category is deleted
 * after a plain confirm; one with products must first have them moved to
 * another category, chosen in the dialog (the server refuses with 409
 * `CATEGORY_NOT_EMPTY` otherwise, which the dialog also handles).
 *
 * Sub-categories (one level): a category can sit inside a top-level one
 * ("Bread" in "Bakery"), chosen with the form's "Inside category" select.
 * The list shows each child indented right under its parent.
 *
 * Category offer (migration 033; owner, 2026-10-09): the edit dialog's Offer
 * section puts a % off everything in the category and its sub-categories,
 * optionally until a day, saved on its own (PUT/DELETE
 * /admin/categories/:id/offer). The list shows an "x% off" tag while the
 * backend says the offer is running.
 *
 * Arrange (owner, 2026-10-10; reworked 2026-10-13): "Arrange" switches the
 * list into an order mode - Top / ↑ / ↓ on each top-level category, and on
 * each sub-category within its parent, with its place ("2 of 5"). Moves
 * change a draft; "Save order" sends one PUT /admin/categories/order per
 * sibling set that changed (the server writes display_order 10, 20, 30...),
 * "Cancel" drops it. "Arrange products" on a category opens its product
 * order screen.
 *
 * Phone layout (2026-10-13): the actions sit on their own wrapping line under
 * the category's details instead of a tall column beside them, so the name,
 * slug and description keep the row's full width.
 *
 * "+ Add sidebar item" (owner, 2026-10-10) on each top-level row opens the
 * Add category form with "Inside category" already set to that row, so
 * Bakery's sidebar items (Bread, Cakes...) take one tap each. Sub-categories
 * are one level only, so sub-category rows don't get the button.
 *
 * Markup % (migration 044; owner, 2026-10-13): a category can carry the
 * markup its MARKUP-priced products use when they have none of their own
 * (sub-categories without one use their parent's; blank everywhere = the
 * global default markup, set under More). Saving reprices those products at
 * once on the server; the row and the dialog say how many follow it.
 */
export const SIDEBAR_ITEM_HINT = "Shows in this category's left sidebar in the app";

export function Categories() {
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  // "+ Add sidebar item": the parent preselected in the Add category form.
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  // For the edit form's Group select. An API without category groups just
  // leaves this empty (the select then offers only "None").
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  // Arrange: the order being edited (null = not arranging). Saved with "Save order".
  const [draft, setDraft] = useState<Category[] | null>(null);
  const [moving, setMoving] = useState(false);
  /** The global default markup, for rows with no markup of their own; null = unknown. */
  const [globalMarkup, setGlobalMarkup] = useState<number | null>(null);

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
    void catalog.categoryGroups
      .list()
      .then((r) => setGroups(r.groups))
      .catch(() => setGroups([]));
    void settings.defaultMarkup
      .get()
      .then((s) => setGlobalMarkup(Number(s.markup_percent)))
      .catch(() => setGlobalMarkup(null));
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

  /** Moves `category` to position `target` among its siblings, in the draft only. */
  function moveCategory(category: Category, target: number) {
    setDraft((current) => (current ? moveAmongSiblings(current, category, target) : current));
  }

  /** "Save order": one PUT /admin/categories/order per sibling set that changed. */
  async function saveOrder() {
    if (!draft || !rows) return;
    const sets = changedSiblingSets(rows, draft);
    if (sets.length === 0) {
      setDraft(null);
      return;
    }
    setMoving(true);
    try {
      for (const ids of sets) await catalog.categories.reorder(ids);
      setNotice('Category order saved.');
      setDraft(null);
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
      await load();
    } finally {
      setMoving(false);
    }
  }

  const arranging = draft !== null;
  const shown = arranging ? draft : rows;
  const nested = shown ? nestedRows(shown) : [];
  const topLevel = nested.filter((r) => r.parent === null).map((r) => r.category);
  const siblingsOf = (parent: Category | null) =>
    parent ? nested.filter((r) => r.parent?.id === parent.id).map((r) => r.category) : topLevel;
  const dirty = arranging && rows !== null && changedSiblingSets(rows, draft).length > 0;

  return (
    <div className="page">
      <PageHeader
        title="Categories"
        description="Used by the customer Home, Categories and Search screens."
        actions={
          arranging ? (
            <>
              <button type="button" className="button button--ghost" disabled={moving} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="button" disabled={moving || !dirty} onClick={() => void saveOrder()}>
                {moving ? 'Saving...' : 'Save order'}
              </button>
            </>
          ) : (
          <>
            <button
              type="button"
              className="button button--ghost"
              aria-pressed={false}
              disabled={!rows || rows.length < 2}
              onClick={() => setDraft(rows ? [...rows] : [])}
            >
              Arrange
            </button>
            <Link className="button button--ghost" to="/catalog/categories/import">
              Import categories
            </Link>
            <button
              type="button"
              className="button"
              onClick={() => {
                setNewParentId(null);
                setEditing('new');
              }}
            >
              Add category
            </button>
          </>
          )
        }
      />

      {arranging ? (
        <p className="page__note" role="status">
          Customers see categories in this order. Move a category up or down, or to the top; sub-categories move
          within their category. Tap Save order when you are done.
        </p>
      ) : null}

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
          {nested.map(({ category, parent }) => {
            const siblings = siblingsOf(parent);
            const index = siblings.findIndex((c) => c.id === category.id);
            return (
            <li
              key={category.id}
              className={`cat-row cat-row--flat cat-row--stacked${parent ? ' cat-row--child' : ''}${arranging ? ' cat-row--arranging' : ''}`}
            >
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
                {parent ? <p className="cat-row__parent">{`In ${parent.name}`}</p> : null}
                <p className="cat-row__meta">{category.slug}</p>
                {category.description ? <p className="cat-row__meta cat-row__desc">{category.description}</p> : null}
                <p className="cat-row__meta">{markupRowText(category, shown ?? [], globalMarkup)}</p>
                {markupProductCountText(category.markup_product_count, category.markup_percent != null) ? (
                  <p className="cat-row__meta">
                    {markupProductCountText(category.markup_product_count, category.markup_percent != null)}
                  </p>
                ) : null}
                <div className="cat-row__badges">
                  <Badge tone={category.is_active ? 'active' : 'inactive'}>{category.is_active ? 'Active' : 'Inactive'}</Badge>
                  {category.offer_active && category.offer_percent != null ? (
                    <span className="offer-tag">{offerPercentLabel(category.offer_percent)}</span>
                  ) : null}
                  <span className="cat-row__order">{`${category.product_count ?? 0} ${category.product_count === 1 ? 'product' : 'products'}`}</span>
                  {arranging ? <span className="cat-row__order">{`Place ${index + 1} of ${siblings.length}`}</span> : null}
                </div>
              </div>
              {arranging ? (
                <div className="cat-row__actions">
                  <div className="order-cell">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Move ${category.name} to the top`}
                      disabled={moving || index <= 0}
                      onClick={() => moveCategory(category, 0)}
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Move ${category.name} up`}
                      disabled={moving || index <= 0}
                      onClick={() => moveCategory(category, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Move ${category.name} down`}
                      disabled={moving || index < 0 || index >= siblings.length - 1}
                      onClick={() => moveCategory(category, index + 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ) : (
              <div className="cat-row__actions">
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(category)}>
                  Edit
                </button>
                <button type="button" className="button button--ghost button--sm" onClick={() => void toggleActive(category)}>
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
                {/* Top-level rows only: sub-categories are one level deep (owner, 2026-10-10). */}
                {!parent && !category.parent_id ? (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    title={SIDEBAR_ITEM_HINT}
                    aria-label={`+ Add sidebar item to ${category.name}`}
                    onClick={() => {
                      setNewParentId(category.id);
                      setEditing('new');
                    }}
                  >
                    + Add sidebar item
                  </button>
                ) : null}
                <Link
                  className="button button--ghost button--sm"
                  to={`/catalog/categories/${category.id}/arrange`}
                  aria-label={`Arrange products in ${category.name}`}
                >
                  Arrange products
                </Link>
              </div>
              )}
            </li>
            );
          })}
        </ul>
      )}

      <p className="page__note">Deactivate a category to hide it for a while; delete it to retire it for good.</p>
      <p className="page__note">
        A category with no markup uses its parent category&apos;s, else the{' '}
        <Link to="/more#default-markup">global default markup</Link>.
      </p>

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          initialParentId={editing === 'new' ? newParentId : null}
          groups={groups}
          categories={rows ?? []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onOfferChanged={() => void load()}
        />
      ) : null}

      {deleting ? (
        <DeleteCategoryDialog
          category={deleting}
          others={(rows ?? []).filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDeleted={async (message) => {
            setDeleting(null);
            setNotice(message);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteCategoryDialog({
  category,
  others,
  onClose,
  onDeleted,
}: {
  category: Category;
  others: Category[];
  onClose(): void;
  onDeleted(message: string): void | Promise<void>;
}) {
  // `product_count` comes with the list; if the server finds products the
  // list didn't know about, its 409 carries the real count instead.
  const [productCount, setProductCount] = useState(category.product_count ?? 0);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsMove = productCount > 0;
  const noun = productCount === 1 ? 'product' : 'products';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await catalog.categories.remove(category.id, needsMove ? moveTo : undefined);
      const target = others.find((c) => c.id === moveTo)?.name;
      await onDeleted(
        result.moved_product_count > 0 && target
          ? `${category.name} was deleted. ${result.moved_product_count} ${result.moved_product_count === 1 ? 'product' : 'products'} moved to ${target}.`
          : `${category.name} was deleted.`
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CATEGORY_NOT_EMPTY') {
        const count = Number((err.details as { product_count?: number } | undefined)?.product_count);
        setProductCount(Number.isFinite(count) && count > 0 ? count : Math.max(productCount, 1));
        setError('This category still has products. Choose where to move them first.');
      } else {
        setError(catalogErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Delete category">
      <div className="modal__panel">
        <h2 className="modal__title">Delete category</h2>
        <p className="modal__message">Delete {category.name}? Customers will no longer see it.</p>
        {needsMove ? (
          <Field label={`Move its ${productCount} ${noun} to:`}>
            <select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">Choose a category</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {needsMove && others.length === 0 ? (
          <p className="field__error">There is no other category to move them to. Add one first.</p>
        ) : null}
        {error ? <p className="field__error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => void confirm()}
            disabled={busy || (needsMove && !moveTo)}
          >
            {busy ? <Spinner label="Deleting" /> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A row's markup in a few words: its own ("Markup 25%"), else where it comes
 * from ("Markup: parent Grocery 15%" / "Markup: global 20%").
 */
export function markupRowText(category: Category, all: Category[], globalMarkup: number | null): string {
  if (category.markup_percent !== null && category.markup_percent !== undefined) {
    return `Markup ${percentText(Number(category.markup_percent))}`;
  }
  const inherited = inheritedMarkup(category.id, all, globalMarkup);
  if (inherited.source === 'PARENT_CATEGORY_MARKUP') {
    return `Markup: parent ${inherited.categoryName} ${percentText(inherited.percent)}`;
  }
  return globalMarkup === null ? 'Markup: global' : `Markup: global ${percentText(globalMarkup)}`;
}

/** The sibling set (same parent) under `parentId` within `list`, in list order. */
function siblingSet(list: Category[], parentId: string | null): Category[] {
  const ids = new Set(list.map((c) => c.id));
  return list.filter((c) => (c.parent_id && ids.has(c.parent_id) ? c.parent_id : null) === parentId);
}

/** `list` with `category` moved to position `target` among its siblings (other rows keep their places). */
export function moveAmongSiblings(list: Category[], category: Category, target: number): Category[] {
  const ids = new Set(list.map((c) => c.id));
  const parentId = category.parent_id && ids.has(category.parent_id) ? category.parent_id : null;
  const siblings = siblingSet(list, parentId);
  const from = siblings.findIndex((c) => c.id === category.id);
  if (from < 0 || target < 0 || target >= siblings.length || target === from) return list;
  const reordered = siblings.filter((c) => c.id !== category.id);
  reordered.splice(target, 0, category);
  const siblingIds = new Set(siblings.map((c) => c.id));
  let next = 0;
  return list.map((c) => (siblingIds.has(c.id) ? reordered[next++]! : c));
}

/** The sibling sets (as id lists) whose order differs between `before` and `after`. */
export function changedSiblingSets(before: Category[], after: Category[]): string[][] {
  const parents = new Set<string | null>([null, ...after.map((c) => c.parent_id ?? null)]);
  const out: string[][] = [];
  for (const parentId of parents) {
    const a = siblingSet(before, parentId).map((c) => c.id);
    const b = siblingSet(after, parentId).map((c) => c.id);
    if (b.length > 0 && a.join(',') !== b.join(',')) out.push(b);
  }
  return out;
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
  initialParentId: presetParentId = null,
  groups,
  categories,
  onClose,
  onSaved,
  onOfferChanged,
}: {
  category: Category | null;
  /** New category only: the "Inside category" to start with ("+ Add sidebar item"). */
  initialParentId?: string | null;
  groups: CategoryGroup[];
  /** Every category, for the "Inside category" select. */
  categories: Category[];
  onClose(): void;
  onSaved(): void | Promise<void>;
  /** The offer was saved or removed (the dialog stays open). */
  onOfferChanged?(): void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(category?.image_url ?? null);
  const [focal, setFocal] = useState<FocalPoint>({
    x: category?.image_focal_x ?? 50,
    y: category?.image_focal_y ?? 50,
  });
  const [displayOrder, setDisplayOrder] = useState(String(category?.display_order ?? 0));
  const [isActive, setIsActive] = useState(category?.is_active ?? true);
  const initialGroupId = category?.group_id ?? '';
  const [groupId, setGroupId] = useState(initialGroupId);
  const initialParentId = category?.parent_id ?? '';
  // A preset parent counts as a change from "top level", so it is sent.
  const [parentId, setParentId] = useState(category ? initialParentId : presetParentId ?? '');
  // One level only: a parent must be top level and not this category, and a
  // category that already has sub-categories stays top level.
  const parentOptions = categories.filter((c) => !c.parent_id && c.id !== category?.id);
  const hasChildren = category ? categories.some((c) => c.parent_id === category.id) : false;
  const presetParent = !category && presetParentId ? categories.find((c) => c.id === presetParentId) ?? null : null;
  const [markup, setMarkup] = useState(
    category?.markup_percent === null || category?.markup_percent === undefined ? '' : String(category.markup_percent)
  );
  const [markupError, setMarkupError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const order = parseDisplayOrder(displayOrder);
    if ('error' in order) {
      setOrderError(order.error);
      return;
    }
    setOrderError(null);
    const markupParsed = parseMarkupPercent(markup);
    if ('error' in markupParsed) {
      setMarkupError(markupParsed.error);
      return;
    }
    setMarkupError(null);
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        image_focal_x: focal.x,
        image_focal_y: focal.y,
        display_order: order.value,
        is_active: isActive,
        // null = use the parent category's markup, else the global one.
        markup_percent: markupParsed.value,
      };
      // Only sent when it changed: re-sending the same group would append
      // the category at the end of that group again.
      if (groupId !== initialGroupId) payload.group_id = groupId || null;
      if (parentId !== initialParentId) payload.parent_id = parentId || null;
      if (category) {
        await catalog.categories.update(category.id, payload);
      } else {
        await catalog.categories.create(payload);
      }
      // Saved: only now is the replaced (or removed) file safe to delete.
      void deleteImagesQuietly(replacedImages([category?.image_url], [imageUrl]));
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
        <h2 className="modal__title">
          {category ? 'Edit category' : presetParent ? `Add sidebar item to ${presetParent.name}` : 'Add category'}
        </h2>
        {presetParent ? <p className="field__hint">{SIDEBAR_ITEM_HINT}.</p> : null}
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
        <Field
          label="Markup %"
          hint="Blank = use the parent category's markup, or the global markup if there is none"
          error={markupError ?? undefined}
        >
          <input
            className="input"
            inputMode="decimal"
            value={markup}
            aria-invalid={markupError ? true : undefined}
            onChange={(e) => {
              setMarkup(e.target.value);
              setMarkupError(null);
            }}
          />
        </Field>
        {category && markupProductCountText(category.markup_product_count, category.markup_percent != null) ? (
          <p className="form__note">
            {`${markupProductCountText(category.markup_product_count, category.markup_percent != null)}. Products with a fixed price or their own markup are not affected; changing it reprices these at once.`}
          </p>
        ) : null}
        <Field label="Display order" error={orderError ?? undefined}>
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
            <em>Inactive categories disappear from the customer app.</em>
          </span>
        </label>
        {category ? (
          <CategoryOfferSection
            category={category}
            subCategories={categories.filter((c) => c.parent_id === category.id)}
            parent={categories.find((c) => c.id === category.parent_id) ?? null}
            onChanged={onOfferChanged}
          />
        ) : (
          <p className="field__hint">Save the category first to put it on offer.</p>
        )}
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
 * The category offer (owner, 2026-10-09): % off everything in the category
 * and its sub-categories, with an optional last day. Saved on its own with
 * Save offer / Remove offer - separate from the category's Save, so an offer
 * never goes out by accident with a rename. Checks mirror the server's
 * (more than 0, less than 100, at most 2 decimals, a changed end in the
 * future); the server's own refusal is shown as it says it.
 */
function CategoryOfferSection({
  category,
  subCategories,
  parent,
  onChanged,
}: {
  category: Category;
  subCategories: Category[];
  parent: Category | null;
  onChanged?(): void;
}) {
  const [saved, setSaved] = useState({
    percent: category.offer_percent ?? null,
    endsAt: category.offer_ends_at ?? null,
    active: category.offer_active === true,
  });
  const [percent, setPercent] = useState(saved.percent === null ? '' : String(saved.percent));
  const [endDay, setEndDay] = useState(saved.endsAt ? colomboDay(saved.endsAt) : '');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const savedDay = saved.endsAt ? colomboDay(saved.endsAt) : '';
  const endChanged = endDay !== savedDay;
  const ended = saved.percent !== null && saved.endsAt !== null && new Date(saved.endsAt).getTime() <= Date.now();
  const parsed = percent.trim() === '' ? null : parseOfferPercent(percent);
  const scope =
    subCategories.length > 0
      ? `everything in ${category.name} and its sub-categories (${subCategories.map((c) => c.name).join(', ')})`
      : `everything in ${category.name}`;

  function apply(next: Category, message: string) {
    const fresh = {
      percent: next.offer_percent ?? null,
      endsAt: next.offer_ends_at ?? null,
      active: next.offer_active === true,
    };
    setSaved(fresh);
    setPercent(fresh.percent === null ? '' : String(fresh.percent));
    setEndDay(fresh.endsAt ? colomboDay(fresh.endsAt) : '');
    setNotice(message);
    onChanged?.();
  }

  async function save() {
    setError(null);
    setNotice(null);
    if (!parsed) {
      setError('Enter the % off, like 10 or 12.5.');
      return;
    }
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    if (endDay !== '' && endChanged && endDay < colomboTodayDay()) {
      setError('Pick today or a later day for the offer to end.');
      return;
    }
    if (endDay !== '' && !endChanged && ended) {
      setError('This offer has ended. Pick a new end day, or clear it for no end.');
      return;
    }
    setBusy('save');
    try {
      // An untouched end goes back exactly as stored: the form only knows it
      // as a day, and resending a rebuilt time could move it.
      const offerEndsAt = endDay === '' ? null : endChanged ? offerEndForDay(endDay) : saved.endsAt;
      const next = await catalog.categories.setOffer(category.id, {
        offer_percent: parsed.value,
        offer_ends_at: offerEndsAt,
      });
      apply(next, 'Offer saved.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setError(null);
    setNotice(null);
    setBusy('remove');
    try {
      apply(await catalog.categories.removeOffer(category.id), 'Offer removed.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // Enter in an offer field saves the offer, not the category form around it.
  const saveOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (busy === null) void save();
  };

  return (
    <section className="form__section" aria-labelledby="category-offer-title">
      <h3 className="form__section-title" id="category-offer-title">
        Offer
      </h3>
      {saved.percent !== null ? (
        <p className="offer-summary">
          {saved.active ? (
            <span className="offer-tag">Running now</span>
          ) : ended ? (
            <span className="offer-tag offer-tag--ended">Ended on {formatColomboDate(saved.endsAt!)}</span>
          ) : (
            <span className="offer-tag offer-tag--ended">Not running</span>
          )}
          {`${offerPercentLabel(saved.percent)}${saved.endsAt && !ended ? ` until ${formatColomboDate(saved.endsAt)}` : ''}`}
        </p>
      ) : null}
      <div className="form__row">
        <Field label="Offer (% off)" hint="More than 0 and less than 100">
          <input
            className="input"
            inputMode="decimal"
            value={percent}
            onKeyDown={saveOnEnter}
            onChange={(e) => {
              setPercent(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field label="Offer ends" hint="Optional - the offer runs to the end of this day">
          <input
            className="input"
            type="date"
            value={endDay}
            // No floor while showing a stored end that has passed.
            min={ended && !endChanged ? undefined : colomboTodayDay()}
            onKeyDown={saveOnEnter}
            onChange={(e) => {
              setEndDay(e.target.value);
              setError(null);
            }}
          />
        </Field>
      </div>
      {parsed && 'value' in parsed ? (
        <p className="form__note" role="status">
          {`${offerPercentLabel(parsed.value)} ${scope}${endDay ? ` until ${formatColomboDate(offerEndForDay(endDay))}` : ''}.`}
        </p>
      ) : null}
      {parent ? (
        <p className="form__note">
          {`${category.name} is inside ${parent.name}: when both have an offer, customers get the bigger one.`}
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}
      {notice ? (
        <p className="form__note" role="status">
          {notice}
        </p>
      ) : null}
      <div className="offer-actions">
        <button type="button" className="button button--sm" disabled={busy !== null} onClick={() => void save()}>
          {busy === 'save' ? <Spinner label="Saving offer" /> : 'Save offer'}
        </button>
        {saved.percent !== null ? (
          <button
            type="button"
            className="button button--ghost button--sm"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === 'remove' ? <Spinner label="Removing offer" /> : 'Remove offer'}
          </button>
        ) : null}
      </div>
    </section>
  );
}
