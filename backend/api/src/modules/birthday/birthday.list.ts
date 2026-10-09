import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { ageOn, birthdayIn, colomboDay, daysUntil, isoDay, monthDayCodes, parseIsoDate } from './birthday.rules.js';
import { BIRTHDAY_WINDOW_DAYS } from '../configuration/settings.service.js';
import { orderingClock } from '../../utils/time.js';

/**
 * "Birthdays this week" for Admin and Operations (owner, 2026-10-09):
 * customers whose birthday is from 3 days ago (still in its gift week) to
 * `days` ahead, with what they told us they love and whether they have used
 * this birthday's gift.
 */
export const MAX_BIRTHDAY_LIST_DAYS = 31;

/** Category names for a set of ids (deleted categories left out). */
export async function categoryNames(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db
    .selectFrom('categories')
    .select(['id', 'name'])
    .where('id', 'in', ids)
    .where('deleted_at', 'is', null)
    .execute();
  for (const r of rows) map.set(r.id, r.name);
  return map;
}

export const favouritesOf = (ids: string[] | null | undefined, names: Map<string, string>) =>
  (ids ?? []).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! }));

export async function listBirthdays(params: { days: number; now?: Date }) {
  const today = colomboDay(params.now ?? orderingClock.now());
  const range = [];
  for (let d = -BIRTHDAY_WINDOW_DAYS; d <= params.days; d++) range.push(today.plus({ days: d }));
  const codes = monthDayCodes(range);

  const rows = await db
    .selectFrom('users as u')
    .select([
      'u.id',
      'u.full_name',
      'u.phone',
      sql<string>`u.date_of_birth::text`.as('date_of_birth'),
      'u.favourite_category_ids',
      'u.favourites_note',
    ])
    .where('u.role', '=', 'CUSTOMER')
    .where('u.is_active', '=', true)
    .where('u.date_of_birth', 'is not', null)
    .where(sql<boolean>`(EXTRACT(MONTH FROM u.date_of_birth) * 100 + EXTRACT(DAY FROM u.date_of_birth)) = ANY(${codes}::numeric[])`)
    .execute();

  const names = await categoryNames([...new Set(rows.flatMap((r) => r.favourite_category_ids ?? []))]);
  const used = rows.length
    ? await db
        .selectFrom('birthday_offer_redemptions')
        .select(['customer_id', 'offer_year'])
        .where('customer_id', 'in', rows.map((r) => r.id))
        .where('released_at', 'is', null)
        .execute()
    : [];
  const usedKey = new Set(used.map((u) => `${u.customer_id}:${u.offer_year}`));

  const customers = [];
  for (const r of rows) {
    const dob = parseIsoDate(r.date_of_birth);
    if (!dob) continue;
    // The occurrence inside the range (last year's, this year's or next year's).
    const birthday = [today.year - 1, today.year, today.year + 1]
      .map((y) => birthdayIn(dob, y))
      .find((b) => {
        const n = daysUntil(b, today);
        return n >= -BIRTHDAY_WINDOW_DAYS && n <= params.days;
      });
    if (!birthday) continue;
    customers.push({
      id: r.id,
      full_name: r.full_name,
      phone: r.phone,
      date_of_birth: r.date_of_birth,
      birthday: isoDay(birthday),
      days_until: daysUntil(birthday, today),
      turning: ageOn(dob, birthday),
      favourite_categories: favouritesOf(r.favourite_category_ids, names),
      favourites_note: r.favourites_note,
      offer_used: usedKey.has(`${r.id}:${birthday.year}`),
    });
  }
  customers.sort((a, b) => a.days_until - b.days_until || (a.full_name ?? '').localeCompare(b.full_name ?? ''));
  return { today: isoDay(today), customers };
}
