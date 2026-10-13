import { errorMessage } from '../lib/apiErrors';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { categories as categoriesApi, categoryGroups as groupsApi, settings as settingsApi } from '../api/resources';
import type { Category, CategoryGroup } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, Field, Spinner, useToast } from '../components/ui';
import { endOfDay, validateCategoryOffer } from '../lib/combos';
import { colomboDate, formatDay } from '../lib/coupons';
import { formatPercent, inheritedMarkup, parseMarkupInput } from '../lib/pricing';

/**
 * Categories: create, edit, activate/deactivate and delete.
 *
 * Deleting a category that still has products needs somewhere to move them:
 * the API refuses (409 CATEGORY_NOT_EMPTY) without a target, so the dialog
 * asks for one up front using the list's product_count.
 *
 * Sub-categories (one level): a category can sit inside a top-level one
 * ("Bread" in "Bakery"). The list shows each child right under its parent.
 *
 * Arrange (owner, 2026-10-10; reworked 2026-10-13): "Arrange" switches the
 * last column to Top / ↑ / ↓ - top-level categories among themselves,
 * sub-categories within their parent. Moves change a draft; "Save order"
 * sends one PUT /admin/categories/order per sibling set that changed (the
 * server writes display_order 10, 20, 30...), "Cancel" drops the draft.
 * "Arrange products" opens a category's product order.
 *
 * Layout (2026-10-13): table cells never carry the block-level cell__*
 * classes themselves - a <td> with display:block falls out of the table
 * grid, which stacked Name/slug/description in the first column and pushed
 * the Status/Actions columns (and the Arrange buttons) off the row. The
 * texts sit in spans inside the cells instead.
 *
 * "+ Add sidebar item" (owner, 2026-10-10) on each top-level row opens the
 * Add category form with "Inside category" already set to that row, so
 * Bakery's sidebar items (Bread, Cakes...) take one tap each. Sub-categories
 * are one level only, so sub-category rows don't get the button.
 *
 * Markup % (migration 044; owner, 2026-10-13): the markup for MARKUP
 * products in the category without their own; blank = the parent
 * category's, else the global default (Settings). Saving reprices every
 * product that follows it straight away.
 */
export const SIDEBAR_ITEM_HINT = "Shows in this category's left sidebar in the app";

export function Categories() {
  const toast = useToast();
  const [rows, setRows] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  // "+ Add sidebar item": the parent preselected in the Add category form.
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  // Category offer (owner, 2026-10-09).
  const [offering, setOffering] = useState<Category | null>(null);
  // For the edit form's Group select; without category groups on the API
  // the select just offers "None".
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  // Arrange: the order being edited (null = not arranging). Saved with "Save order".
  const [draft, setDraft] = useState<Category[] | null>(null);
  const [moving, setMoving] = useState(false);
  // The global default markup, for "Global 20%" on rows without a markup.
  const [globalMarkup, setGlobalMarkup] = useState<number | null>(null);

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
    settingsApi
      .getDefaultMarkup()
      .then((setting) => setGlobalMarkup(Number(setting.markup_percent)))
      .catch(() => setGlobalMarkup(null));
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

  /** Arrange: starts a draft of the current order (nothing is saved until "Save order"). */
  function startArranging() {
    setDraft(rows ? [...rows] : []);
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
      for (const ids of sets) await categoriesApi.reorder(ids);
      toast.success('Category order saved.');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the new order.'));
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
    <>
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
                onClick={startArranging}
              >
                Arrange
              </button>
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
        <p className="form__note" role="status">
          Customers see categories in this order. Move a category up or down, or to the top; sub-categories move
          within their category. Press Save order when you are done.
        </p>
      ) : null}

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading categories" />
      ) : rows.length === 0 ? (
        <p className="empty">No categories yet. Add the first one.</p>
      ) : (
        <div className="table-wrap">
          <table className="table categories-table">
            <colgroup>
              <col className="categories-table__name" />
              <col className="categories-table__desc" />
              <col className="categories-table__markup" />
              <col className="categories-table__count" />
              <col className="categories-table__status" />
              <col className="categories-table__actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Description</th>
                <th scope="col">Markup</th>
                <th scope="col" className="num">
                  Products
                </th>
                <th scope="col">Status</th>
                <th scope="col">{arranging ? 'Order' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {nested.map(({ category, parent }) => {
                const siblings = siblingsOf(parent);
                const index = siblings.findIndex((c) => c.id === category.id);
                return (
                  <tr key={category.id} className={parent ? 'row--child' : undefined}>
                    <td>
                      <span className="cell__primary">
                        {parent ? <span aria-hidden="true">{'↳ '}</span> : null}
                        {category.name}
                      </span>
                      <span className="cell__secondary mono">{category.slug}</span>
                      {parent ? <span className="cell__note">{`in ${parent.name}`}</span> : null}
                    </td>
                    <td>
                      <span className="cell__secondary cell__clamp">{category.description || '—'}</span>
                    </td>
                    <td>
                      <MarkupCell category={category} categories={shown ?? []} globalMarkup={globalMarkup} />
                    </td>
                    <td className="num">{category.product_count ?? 0}</td>
                    <td>
                      <div className="cell__badges">
                        <Badge tone={category.is_active ? 'active' : 'inactive'}>
                          {category.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        {/* Category offer, while it runs (owner, 2026-10-09). */}
                        {category.offer_active && category.offer_percent != null ? (
                          <Badge tone="offer">{`${category.offer_percent}% off`}</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      {arranging ? (
                        <div className="row-actions">
                          <span className="cell__secondary arrange-position">{`${index + 1} of ${siblings.length}`}</span>
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
                      ) : (
                        <div className="row-actions row-actions--wrap">
                          <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(category)}>
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
                            to={`/categories/${category.id}/arrange`}
                            aria-label={`Arrange products in ${category.name}`}
                          >
                            Arrange products
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="form__note">
        Deactivate a category to hide it for a while; delete it to retire it
        for good (its products move to another category first).
      </p>
      <p className="form__note">
        Markup: products priced by markup without their own use their category&apos;s markup, else the parent
        category&apos;s, else the global default markup{globalMarkup === null ? '' : ` (${formatPercent(globalMarkup)}%)`}{' '}
        set under <Link to="/settings#default-markup">Settings</Link>. Fixed-price products are not affected.
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
          initialParentId={editing === 'new' ? newParentId : null}
          groups={groups}
          categories={rows ?? []}
          globalMarkup={globalMarkup}
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

const productsText = (n: number) => `${n} ${n === 1 ? 'product' : 'products'}`;

/**
 * The list's Markup cell: "25%" when the category has its own, else what it
 * inherits ("Parent 15%" / "Global 20%"), with how many products follow it.
 */
function MarkupCell({
  category,
  categories,
  globalMarkup,
}: {
  category: Category;
  categories: Category[];
  globalMarkup: number | null;
}) {
  const own = category.markup_percent;
  const count = category.markup_product_count;
  let label: string;
  if (own !== null && own !== undefined) {
    label = `${formatPercent(Number(own))}%`;
  } else {
    const inherited = inheritedMarkup(category.id, categories, globalMarkup);
    label =
      inherited.source === 'PARENT_CATEGORY_MARKUP'
        ? `Parent ${formatPercent(inherited.markup)}%`
        : globalMarkup === null
          ? 'Global'
          : `Global ${formatPercent(inherited.markup)}%`;
  }
  return (
    <>
      <span className={own !== null && own !== undefined ? 'cell__primary' : 'cell__secondary'}>{label}</span>
      {count !== undefined ? <span className="cell__secondary">{`used by ${productsText(count)}`}</span> : null}
    </>
  );
}

/** The sibling set (same parent) of `category` within `list`, in list order. */
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
  globalMarkup = null,
  onClose,
  onSaved,
}: {
  category: Category | null;
  /** New category only: the "Inside category" to start with ("+ Add sidebar item"). */
  initialParentId?: string | null;
  groups: CategoryGroup[];
  /** Every category, for the "Inside category" select. */
  categories: Category[];
  /** The global default markup (null = not known). */
  globalMarkup?: number | null;
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
  // A preset parent counts as a change from "top level", so it is sent.
  const [parentId, setParentId] = useState(category ? initialParentId : presetParentId ?? '');
  // One level only: a parent must be top level and not this category, and a
  // category that already has sub-categories stays top level.
  const parentOptions = categories.filter((c) => !c.parent_id && c.id !== category?.id);
  const hasChildren = category ? categories.some((c) => c.parent_id === category.id) : false;
  const presetParent = !category && presetParentId ? categories.find((c) => c.id === presetParentId) ?? null : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Markup % (migration 044): blank = the parent's, else the global default.
  const [markup, setMarkup] = useState(
    category?.markup_percent === null || category?.markup_percent === undefined ? '' : String(category.markup_percent)
  );
  const [markupError, setMarkupError] = useState<string | null>(null);
  const parentCategory = parentId ? categories.find((c) => c.id === parentId) ?? null : null;
  const parentMarkup = parentCategory?.markup_percent;
  const fallbackText =
    parentMarkup !== null && parentMarkup !== undefined
      ? `${parentCategory!.name}'s ${formatPercent(Number(parentMarkup))}%`
      : `the global markup${globalMarkup === null ? '' : ` (${formatPercent(globalMarkup)}%)`}`;
  const followers = category?.markup_product_count;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    const parsedMarkup = parseMarkupInput(markup);
    if ('error' in parsedMarkup) {
      setMarkupError(parsedMarkup.error);
      return;
    }
    setMarkupError(null);
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<Category> = {
        name: name.trim(),
        description: description.trim() || null,
        display_order: Number(displayOrder) || 0,
        is_active: isActive,
        // null = use the parent category's markup, else the global default.
        markup_percent: parsedMarkup.value,
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
        <h2 className="modal__title">
          {category ? 'Edit category' : presetParent ? `Add sidebar item to ${presetParent.name}` : 'Add category'}
        </h2>
        {presetParent ? <p className="form__note">{SIDEBAR_ITEM_HINT}.</p> : null}
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
        <Field
          label="Markup %"
          hint={`0 to 999.99. Leave blank to use ${fallbackText}. Products with their own markup or a fixed price keep it.`}
          error={markupError ?? undefined}
        >
          <input className="input" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
        </Field>
        {followers !== undefined ? (
          <p className="form__note" role="status">
            {markup.trim() === ''
              ? `${productsText(followers)} follow the parent/global markup.`
              : `${productsText(followers)} ${followers === 1 ? 'uses' : 'use'} this markup.`}{' '}
            Saving reprices them straight away.
          </p>
        ) : null}
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
