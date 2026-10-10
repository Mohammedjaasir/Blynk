import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { catalog } from '../../api/resources';
import type { CategoryGroup, CategoryGroupsOverview, GroupCategory } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';

const NAME_MAX = 80;

/** Moves the item at `index` one step in `direction`; the same array when it can't move. */
function swapped<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Category groups: the titled rows of category tiles on the customer Home
 * (e.g. "Grocery & Kitchen" -> Vegetables & Fruits, Dairy...).
 *
 * Every change is one call and then a fresh `GET /admin/category-groups`, so
 * the screen always shows what the server stored (groups in `sort_order`,
 * categories in Arrange order, unassigned last). Membership changes always
 * send the group's full new list to `PUT /:id/categories`.
 *
 * Arrange overrides groups (owner, 2026-10-10): the tiles inside a group show
 * in the order set on Categories -> Arrange, so this page has no per-group
 * category order any more (it would only contradict Arrange) - just a note
 * pointing there. The groups' own order among themselves stays here.
 */
export function CategoryGroups() {
  const [data, setData] = useState<CategoryGroupsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CategoryGroup | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await catalog.categoryGroups.list());
      setError(null);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setData({ groups: [], unassigned: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change, shows its outcome, then reloads. */
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      const result = await action();
      setNotice(typeof result === 'string' ? result : success ?? null);
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    } finally {
      setBusy(false);
    }
    await load();
  }

  const groups = data?.groups ?? [];
  const unassigned = data?.unassigned ?? [];

  function moveGroup(index: number, direction: -1 | 1) {
    const next = swapped(groups, index, direction);
    if (next === groups) return;
    void run(() => catalog.categoryGroups.reorder(next.map((g) => g.id)));
  }

  function setMembers(group: CategoryGroup, categoryIds: string[], success?: string) {
    void run(() => catalog.categoryGroups.setCategories(group.id, categoryIds), success);
  }

  function addToGroup(groupId: string, category: GroupCategory) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setMembers(group, [...group.categories.map((c) => c.id), category.id], `${category.name} added to ${group.name}.`);
  }

  return (
    <div className="page">
      <PageHeader
        title="Category groups"
        description="Rows of category tiles on the customer Home, in this order."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add group
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

      <p className="page__note" role="note">
        Order follows Categories → Arrange. The categories inside each group show in that order on the customer
        Home; <Link to="/catalog/categories">arrange them there</Link>.
      </p>

      {data === null ? (
        <Spinner label="Loading category groups" />
      ) : (
        <>
          {groups.length === 0 ? (
            <EmptyState
              title="No groups yet"
              message="Add a group, like Grocery & Kitchen, then put categories in it."
            />
          ) : (
            <ul className="cat-list">
              {groups.map((group, index) => (
                <li key={group.id} className="cat-row cat-group" aria-label={group.name}>
                  <div className="cat-group__head">
                    <div className="cat-row__main">
                      <p className="cat-row__title">{group.name}</p>
                      <div className="cat-row__badges">
                        <Badge tone={group.is_active ? 'active' : 'inactive'}>{group.is_active ? 'Active' : 'Inactive'}</Badge>
                        <span className="cat-row__order">
                          {group.categories.length} {group.categories.length === 1 ? 'category' : 'categories'}
                        </span>
                      </div>
                    </div>
                    <div className="cat-row__actions">
                      <div className="order-cell">
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          aria-label={`Move ${group.name} up`}
                          disabled={busy || index === 0}
                          onClick={() => moveGroup(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          aria-label={`Move ${group.name} down`}
                          disabled={busy || index === groups.length - 1}
                          onClick={() => moveGroup(index, 1)}
                        >
                          ↓
                        </button>
                      </div>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Rename ${group.name}`}
                        onClick={() => setEditing(group)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`${group.is_active ? 'Deactivate' : 'Activate'} ${group.name}`}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => catalog.categoryGroups.update(group.id, { is_active: !group.is_active }),
                            `${group.name} is now ${group.is_active ? 'inactive' : 'active'}.`
                          )
                        }
                      >
                        {group.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Delete ${group.name}`}
                        onClick={() => setDeleting(group)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {group.categories.length === 0 ? (
                    <p className="cat-row__meta">No categories yet.</p>
                  ) : (
                    <ol className="cat-group__members">
                      {group.categories.map((category) => {
                        const ids = group.categories.map((c) => c.id);
                        return (
                          <li key={category.id} className="cat-group__member">
                            <span className="cat-group__member-name">
                              {category.name}
                              {category.is_active ? null : <span className="cat-row__order"> (inactive)</span>}
                            </span>
                            {/* No ↑/↓ here (owner, 2026-10-10): Arrange decides the order. */}
                            <div className="order-cell">
                              <button
                                type="button"
                                className="button button--ghost button--sm"
                                aria-label={`Remove ${category.name} from ${group.name}`}
                                disabled={busy}
                                onClick={() =>
                                  setMembers(
                                    group,
                                    ids.filter((id) => id !== category.id),
                                    `${category.name} removed from ${group.name}.`
                                  )
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  <AddCategoryPicker group={group} groups={groups} unassigned={unassigned} busy={busy} onAdd={(c) => addToGroup(group.id, c)} />
                </li>
              ))}
            </ul>
          )}

          <section className="cat-group__unassigned" aria-label="Unassigned categories">
            <h2 className="section-label">Unassigned categories</h2>
            <p className="page__note">These categories are in no group, so the customer Home doesn't show them in a group row.</p>
            {unassigned.length === 0 ? (
              <p className="cat-row__meta">Every category is in a group.</p>
            ) : (
              <ul className="cat-list">
                {unassigned.map((category) => (
                  <UnassignedRow key={category.id} category={category} groups={groups} busy={busy} onAdd={addToGroup} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {editing ? (
        <GroupDialog
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            setNotice(message);
            await load();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete group"
          message={`Delete ${deleting.name}? Its categories stay, but become unassigned.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const group = deleting;
            setDeleting(null);
            void run(async () => {
              const result = await catalog.categoryGroups.remove(group.id);
              const n = result.released_category_count;
              return n > 0
                ? `${group.name} was deleted. ${n} ${n === 1 ? 'category is' : 'categories are'} now unassigned.`
                : `${group.name} was deleted.`;
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** "Add a category" for one group: unassigned ones first, then ones that would move from another group. */
function AddCategoryPicker({
  group,
  groups,
  unassigned,
  busy,
  onAdd,
}: {
  group: CategoryGroup;
  groups: CategoryGroup[];
  unassigned: GroupCategory[];
  busy: boolean;
  onAdd(category: GroupCategory): void;
}) {
  const [choice, setChoice] = useState('');
  const others = groups.filter((g) => g.id !== group.id && g.categories.length > 0);
  if (unassigned.length === 0 && others.length === 0) return null;
  const all = [...unassigned, ...others.flatMap((g) => g.categories)];

  return (
    <div className="cat-group__add">
      <Field label={`Add a category to ${group.name}`}>
        <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a category</option>
          {unassigned.length > 0 ? (
            <optgroup label="Unassigned">
              {unassigned.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {others.map((g) => (
            <optgroup key={g.id} label={`Move from ${g.name}`}>
              {g.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <button
        type="button"
        className="button button--ghost button--sm"
        aria-label={`Add to ${group.name}`}
        disabled={busy || !choice}
        onClick={() => {
          const category = all.find((c) => c.id === choice);
          setChoice('');
          if (category) onAdd(category);
        }}
      >
        Add
      </button>
    </div>
  );
}

function UnassignedRow({
  category,
  groups,
  busy,
  onAdd,
}: {
  category: GroupCategory;
  groups: CategoryGroup[];
  busy: boolean;
  onAdd(groupId: string, category: GroupCategory): void;
}) {
  const [groupId, setGroupId] = useState('');
  return (
    <li className="cat-row cat-row--flat">
      <div className="cat-row__main">
        <p className="cat-row__title">{category.name}</p>
        <p className="cat-row__meta">{category.slug}</p>
      </div>
      {groups.length > 0 ? (
        <div className="cat-group__add">
          <Field label={`Group for ${category.name}`}>
            <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Choose a group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="button button--ghost button--sm"
            aria-label={`Add ${category.name} to group`}
            disabled={busy || !groupId}
            onClick={() => onAdd(groupId, category)}
          >
            Add to group
          </button>
        </div>
      ) : null}
    </li>
  );
}

function GroupDialog({
  group,
  onClose,
  onSaved,
}: {
  group: CategoryGroup | null;
  onClose(): void;
  onSaved(message: string): void | Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [isActive, setIsActive] = useState(group?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('Enter a name for the group.');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Keep the name to ${NAME_MAX} characters or fewer.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (group) {
        await catalog.categoryGroups.update(group.id, { name: trimmed, is_active: isActive });
        await onSaved(`${trimmed} saved.`);
      } else {
        await catalog.categoryGroups.create({ name: trimmed, is_active: isActive });
        await onSaved(`${trimmed} added.`);
      }
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Category group">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">{group ? 'Edit group' : 'Add group'}</h2>
        <Field label="Name">
          <input className="input" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="toggle">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>
            <strong>Active</strong>
            <em>Inactive groups are hidden from the customer Home.</em>
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
