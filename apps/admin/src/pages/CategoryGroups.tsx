import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { categoryGroups as groupsApi } from '../api/resources';
import type { CategoryGroup, CategoryGroupsOverview, GroupCategory } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';

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
 * Every change is one call followed by a fresh GET, so the page always shows
 * what the server stored. Membership changes send the group's full new list
 * to PUT /admin/category-groups/:id/categories, which sets both who is in
 * the group and their order.
 */
export function CategoryGroups() {
  const toast = useToast();
  const [data, setData] = useState<CategoryGroupsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CategoryGroup | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CategoryGroup | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await groupsApi.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load category groups.');
      setData({ groups: [], unassigned: [] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one change, toasts its outcome (a returned string wins), then reloads. */
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      const result = await action();
      const message = typeof result === 'string' ? result : success;
      if (message) toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the change.');
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
    void run(() => groupsApi.reorder(next.map((g) => g.id)));
  }

  function setMembers(group: CategoryGroup, categoryIds: string[], success?: string) {
    void run(() => groupsApi.setCategories(group.id, categoryIds), success);
  }

  function addToGroup(groupId: string, category: GroupCategory) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setMembers(group, [...group.categories.map((c) => c.id), category.id], `${category.name} added to ${group.name}.`);
  }

  return (
    <>
      <PageHeader
        title="Category groups"
        description="Rows of category tiles on the customer Home, in this order."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add group
          </button>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {data === null ? (
        <Spinner label="Loading category groups" />
      ) : (
        <>
          {groups.length === 0 ? (
            <EmptyState title="No groups yet" message="Add a group, like Grocery & Kitchen, then put categories in it." />
          ) : (
            <div className="group-list">
              {groups.map((group, index) => {
                const ids = group.categories.map((c) => c.id);
                return (
                  <section key={group.id} className="panel group-panel" aria-label={group.name}>
                    <div className="group-panel__head">
                      <div>
                        <h2 className="panel__title">{group.name}</h2>
                        <div className="group-panel__meta">
                          <Badge tone={group.is_active ? 'active' : 'inactive'}>
                            {group.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          <span className="cell__secondary">
                            {group.categories.length} {group.categories.length === 1 ? 'category' : 'categories'}
                          </span>
                        </div>
                      </div>
                      <div className="row-actions">
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
                              () => groupsApi.update(group.id, { is_active: !group.is_active }),
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
                      <p className="panel__body">No categories yet.</p>
                    ) : (
                      <table className="table">
                        <thead>
                          <tr>
                            <th scope="col">Category</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.categories.map((category, ci) => (
                            <tr key={category.id}>
                              <td>
                                <span className="cell__primary">{category.name}</span>
                                <span className="cell__secondary">{category.slug}</span>
                              </td>
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
                                    aria-label={`Move ${category.name} up in ${group.name}`}
                                    disabled={busy || ci === 0}
                                    onClick={() => setMembers(group, swapped(ids, ci, -1))}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="button button--ghost button--sm"
                                    aria-label={`Move ${category.name} down in ${group.name}`}
                                    disabled={busy || ci === ids.length - 1}
                                    onClick={() => setMembers(group, swapped(ids, ci, 1))}
                                  >
                                    ↓
                                  </button>
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
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <AddCategoryPicker
                      group={group}
                      groups={groups}
                      unassigned={unassigned}
                      busy={busy}
                      onAdd={(c) => addToGroup(group.id, c)}
                    />
                  </section>
                );
              })}
            </div>
          )}

          <section className="group-unassigned" aria-label="Unassigned categories">
            <h2 className="section-label">Unassigned categories</h2>
            <p className="form__note">
              These categories are in no group, so the customer Home doesn't show them in a group row.
            </p>
            {unassigned.length === 0 ? (
              <p className="form__note">Every category is in a group.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Status</th>
                      <th scope="col">Add to group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassigned.map((category) => (
                      <UnassignedRow
                        key={category.id}
                        category={category}
                        groups={groups}
                        busy={busy}
                        onAdd={addToGroup}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {editing ? (
        <GroupDialog
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
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
              const result = await groupsApi.remove(group.id);
              const n = result.released_category_count;
              return n > 0
                ? `${group.name} is deleted. ${n} ${n === 1 ? 'category is' : 'categories are'} now unassigned.`
                : `${group.name} is deleted.`;
            });
          }}
        />
      ) : null}
    </>
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
    <div className="group-add">
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
    <tr>
      <td>
        <span className="cell__primary">{category.name}</span>
        <span className="cell__secondary">{category.slug}</span>
      </td>
      <td>
        <Badge tone={category.is_active ? 'active' : 'inactive'}>{category.is_active ? 'Active' : 'Inactive'}</Badge>
      </td>
      <td>
        {groups.length > 0 ? (
          <div className="row-actions">
            <select
              className="input group-select"
              aria-label={`Group for ${category.name}`}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Choose a group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
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
        ) : (
          <span className="cell__secondary">Add a group first</span>
        )}
      </td>
    </tr>
  );
}

function GroupDialog({
  group,
  onClose,
  onSaved,
}: {
  group: CategoryGroup | null;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const toast = useToast();
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
        await groupsApi.update(group.id, { name: trimmed, is_active: isActive });
        toast.success(`${trimmed} saved.`);
      } else {
        await groupsApi.create({ name: trimmed, is_active: isActive });
        toast.success(`${trimmed} added.`);
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the group.');
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
