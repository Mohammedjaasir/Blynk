import type { Category } from '../api/types';
import { Field } from './ui';
import { MAX_EXTRA_CATEGORIES, extraCategoryChoices, extraCategoryLabels } from '../lib/extraCategories';

/**
 * "Also show in": the other categories a product is listed in (migration 060). The main
 * Category above keeps driving the offer, the available hours and the markup; these only add the
 * product to more category pages. Up to 5; the main category is not offered. Admin has its own copy.
 */
export function ExtraCategories({
  categories,
  primaryId,
  value,
  onChange,
  error,
}: {
  categories: Category[];
  primaryId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  const choices = extraCategoryChoices(categories, primaryId, value);
  const full = value.length >= MAX_EXTRA_CATEGORIES;
  return (
    <Field
      label="Also show in"
      hint={`Optional, up to ${MAX_EXTRA_CATEGORIES}. The product also appears in these categories; its offer, hours and price still follow the main category.`}
      error={error}
    >
      <div>
        {value.length ? (
          <ul className="extra-categories" aria-label="Also shown in">
            {extraCategoryLabels(categories, value).map((c) => (
              <li key={c.id} className="extra-categories__item">
                <span>{c.label}</span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Remove ${c.label}`}
                  onClick={() => onChange(value.filter((id) => id !== c.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <select
          className="input"
          aria-label="Add a category to also show in"
          value=""
          disabled={full || choices.length === 0}
          onChange={(event) => {
            if (event.target.value) onChange([...value, event.target.value]);
          }}
        >
          <option value="">{full ? `${MAX_EXTRA_CATEGORIES} chosen (the most)` : 'Add a category...'}</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}
