/* Blynk Ops copy of apps/admin/src/lib/homeSections.ts (common.md rule 2: no cross-app imports) - keep the two in step. */
/*
 * Home sections (owner's brother, 2026-10-24: "if we need snacks, if we need juices to come, and
 * showcase timely offers also with a countdown timer"): staff-made product rails on the customer
 * app's Home. A section shows a category's products, or up to 12 picked ones; it can start and end
 * at a time (Sri Lanka time) and show a live countdown to its end. GET|PUT
 * /admin/settings/home-sections (backend/api/src/modules/configuration/home-sections.ts); PUT
 * replaces the whole list and the array order is the order on Home.
 */

export type HomeSectionStatus = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'OFF';

export type HomeSectionSource = { kind: 'CATEGORY'; category_id: string } | { kind: 'PRODUCTS'; product_ids: string[] };

/** What the PUT carries for one section (`id` is missing until the server has assigned one). */
export interface HomeSection {
  id?: string;
  title: string;
  subtitle: string | null;
  source: HomeSectionSource;
  is_active: boolean;
  /** ISO datetime with offset; before it the section is hidden. */
  starts_at: string | null;
  /** ISO datetime with offset; after it the section is hidden. */
  ends_at: string | null;
  show_countdown: boolean;
  max_items: number;
}

export interface HomeSectionView extends HomeSection {
  id: string;
  status: HomeSectionStatus;
  /** "Beverages › Juices", or "3 products". */
  source_name: string;
  /** PRODUCTS source: the picked products, in order. */
  products: { id: string; name: string }[];
}

export interface HomeSectionsSetting {
  sections: HomeSectionView[];
  updated_at: string | null;
}

/** A section being edited: saved ones keep their id, new ones get one from the server. `key` only identifies the row on screen. */
export interface HomeSectionDraft extends HomeSection {
  key: string;
  /** Names for the picked products / the category, so the screen can show them without another call. */
  products: { id: string; name: string }[];
  source_name: string;
}

export const HOME_SECTIONS_LIMITS = {
  sections: 8,
  title: { min: 2, max: 28 },
  subtitle: 40,
  products: 12,
  maxItems: { min: 4, max: 12, default: 8 },
} as const;

/** Sri Lanka has no daylight saving: the store's zone is a fixed +05:30. */
const STORE_OFFSET = '+05:30';

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO time -> the value of an <input type="datetime-local">, in Sri Lanka time whatever the browser's zone is. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + 330 * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** An <input type="datetime-local"> value (Sri Lanka time) -> ISO with offset; null when empty or invalid. */
export function fromLocalInput(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const iso = `${local}:00${STORE_OFFSET}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Same rule as the API: OFF when switched off, else by the schedule. */
export function sectionStatus(s: Pick<HomeSection, 'is_active' | 'starts_at' | 'ends_at'>, at: Date = new Date()): HomeSectionStatus {
  if (!s.is_active) return 'OFF';
  const t = at.getTime();
  if (s.starts_at && t < Date.parse(s.starts_at)) return 'SCHEDULED';
  if (s.ends_at && t >= Date.parse(s.ends_at)) return 'ENDED';
  return 'LIVE';
}

export const STATUS_WORDS: Record<HomeSectionStatus, string> = {
  LIVE: 'Live now',
  SCHEDULED: 'Scheduled',
  ENDED: 'Ended',
  OFF: 'Switched off',
};

/** "Ends in 02:14:09", or with days from 24 h: "Ends in 2d 04:10". Empty once it is over. */
export function countdownText(endsAt: string | null, at: Date = new Date()): string {
  if (!endsAt) return '';
  const left = Math.floor((Date.parse(endsAt) - at.getTime()) / 1000);
  if (!Number.isFinite(left) || left <= 0) return '';
  const days = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return days >= 1 ? `Ends in ${days}d ${pad(h)}:${pad(m)}` : `Ends in ${pad(h)}:${pad(m)}:${pad(s)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct, 6 pm" in Sri Lanka time. */
export function dateTimeText(iso: string): string {
  const local = toLocalInput(iso);
  if (!local) return iso;
  const [date, time] = local.split('T') as [string, string];
  const h = Number(time.slice(0, 2));
  const m = time.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}, ${h12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}

/** "From 24 Oct, 9 am until 24 Oct, 6 pm", or "Always on" with no schedule. */
export function scheduleText(s: Pick<HomeSection, 'starts_at' | 'ends_at'>): string {
  if (s.starts_at && s.ends_at) return `${dateTimeText(s.starts_at)} to ${dateTimeText(s.ends_at)}`;
  if (s.starts_at) return `From ${dateTimeText(s.starts_at)}`;
  if (s.ends_at) return `Until ${dateTimeText(s.ends_at)}`;
  return 'No schedule: always on';
}

/** What is wrong with one section, in words for the form; null = fine. Same rules as the API. */
export function sectionProblem(s: HomeSection): string | null {
  const title = s.title.trim();
  if (title.length < HOME_SECTIONS_LIMITS.title.min) return `Give the section a title (at least ${HOME_SECTIONS_LIMITS.title.min} characters).`;
  if (title.length > HOME_SECTIONS_LIMITS.title.max) return `The title can be at most ${HOME_SECTIONS_LIMITS.title.max} characters.`;
  if ((s.subtitle ?? '').trim().length > HOME_SECTIONS_LIMITS.subtitle) return `The subtitle can be at most ${HOME_SECTIONS_LIMITS.subtitle} characters.`;
  if (s.source.kind === 'CATEGORY' && !s.source.category_id) return `"${title}": choose a category.`;
  if (s.source.kind === 'PRODUCTS' && s.source.product_ids.length === 0) return `"${title}": pick at least one product.`;
  if (s.source.kind === 'PRODUCTS' && s.source.product_ids.length > HOME_SECTIONS_LIMITS.products) {
    return `"${title}": at most ${HOME_SECTIONS_LIMITS.products} products.`;
  }
  if (s.show_countdown && !s.ends_at) return `"${title}": a countdown needs an end time.`;
  if (s.starts_at && s.ends_at && Date.parse(s.ends_at) <= Date.parse(s.starts_at)) return `"${title}": the end must be after the start.`;
  if (!Number.isInteger(s.max_items) || s.max_items < HOME_SECTIONS_LIMITS.maxItems.min || s.max_items > HOME_SECTIONS_LIMITS.maxItems.max) {
    return `"${title}": show between ${HOME_SECTIONS_LIMITS.maxItems.min} and ${HOME_SECTIONS_LIMITS.maxItems.max} products.`;
  }
  return null;
}

/** The first problem across all sections (and the count), or null. */
export function sectionsProblem(list: ReadonlyArray<HomeSection>): string | null {
  if (list.length > HOME_SECTIONS_LIMITS.sections) return `At most ${HOME_SECTIONS_LIMITS.sections} sections.`;
  for (const s of list) {
    const p = sectionProblem(s);
    if (p) return p;
  }
  return null;
}

/** The PUT body: only what the API knows (a new section has no id yet). */
export function sectionsPayload(list: ReadonlyArray<HomeSection>): { sections: HomeSection[] } {
  return {
    sections: list.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      title: s.title.trim(),
      subtitle: (s.subtitle ?? '').trim() || null,
      source:
        s.source.kind === 'CATEGORY'
          ? { kind: 'CATEGORY' as const, category_id: s.source.category_id }
          : { kind: 'PRODUCTS' as const, product_ids: [...s.source.product_ids] },
      is_active: s.is_active,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      show_countdown: s.show_countdown && !!s.ends_at,
      max_items: s.max_items,
    })),
  };
}

/** Move the item at `index` by `delta` places (-1 up, +1 down); the same list when it cannot move. */
export function moveItem<T>(list: ReadonlyArray<T>, index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

let counter = 0;
const newKey = () => `new-${Date.now().toString(36)}-${(counter += 1)}`;

/** A saved section as a draft. */
export function draftFrom(view: HomeSectionView): HomeSectionDraft {
  return { ...view, key: view.id };
}

/** A blank section to fill in. */
export function blankDraft(): HomeSectionDraft {
  return {
    key: newKey(),
    title: '',
    subtitle: null,
    source: { kind: 'CATEGORY', category_id: '' },
    is_active: true,
    starts_at: null,
    ends_at: null,
    show_countdown: false,
    max_items: HOME_SECTIONS_LIMITS.maxItems.default,
    products: [],
    source_name: '',
  };
}
