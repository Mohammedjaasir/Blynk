/*
 * The illustrated grocery items an aisle card's corner animation cycles through (owner,
 * 2026-10-14: the round "FREE DELIVERY" stamp misled customers who had used their free
 * deliveries - "instead of that add some moving animations there"). Illustrations only,
 * never product photos; no claim text; no religious imagery. Emoji from Unicode 12 or older so
 * mid-range Android phones draw them all. Pure.
 */

/** Home's banner beam set (milk, bread, apple, egg, broccoli, banana): the fallback. */
export const BEAM_ITEMS = ['🥛', '🍞', '🍎', '🥚', '🥦', '🍌'] as const;

/** First matching rule wins; keywords are matched against the aisle's name and slug. */
const RULES: { words: RegExp; items: [string, string, string]; bg: string }[] = [
  // fruit and vegetables first: "veggies" must not fall into the dairy rule
  { words: /fruit/, items: ['🍎', '🍌', '🍊'], bg: '#FFF1E6' },
  { words: /\bveg|greens|produce/, items: ['🥦', '🥕', '🍅'], bg: '#EAF7EA' },
  { words: /dairy|milk|\beggs?\b|butter|cheese|yog(h)?urt|curd/, items: ['🥛', '🥚', '🧀'], bg: '#EAF4FC' },
  { words: /bak(e|ery)|bread|\bbuns?\b|biscuit|cookie|cracker|cake/, items: ['🍞', '🍪', '🥐'], bg: '#FBF0E2' },
  { words: /rice|grocer|grain|dhal|\bdal\b|pulse|lentil|flour|staple/, items: ['🍚', '🌾', '🥥'], bg: '#F6F3E3' },
  { words: /spice|masala|chilli|chili|curry/, items: ['🌶️', '🧄', '🧅'], bg: '#FCEAE8' },
  { words: /\boils?\b|sugar|salt/, items: ['🥥', '🧂', '🍯'], bg: '#FDF3DD' },
  { words: /meat|chicken|poultry|mutton|beef/, items: ['🍗', '🥩', '🍖'], bg: '#FBE9EC' },
  { words: /fish|sea ?food|prawn|shrimp/, items: ['🐟', '🦐', '🦀'], bg: '#E6F4F6' },
  { words: /\btea\b|coffee/, items: ['🍵', '☕', '🍪'], bg: '#F2E9E0' },
  { words: /beverage|drink|juice|water|soda/, items: ['🧃', '🥤', '🥥'], bg: '#EDEBFA' },
  { words: /snack|chip|sweet|chocolate|candy|confection/, items: ['🍫', '🍬', '🍿'], bg: '#FBEAF1' },
  { words: /frozen|ice ?cream/, items: ['🍦', '🧊', '🍨'], bg: '#E8F3FA' },
  { words: /baby|infant|kid/, items: ['🍼', '🧸', '🧷'], bg: '#EDF2FC' },
  { words: /household|clean|laundry|detergent|home care|kitchen/, items: ['🧽', '🧴', '🧹'], bg: '#E7F6F1' },
  { words: /personal|beauty|cosmetic|care|hygiene|bath|soap/, items: ['🧴', '🧼', '🧻'], bg: '#F2EBF7' },
  { words: /\bpets?\b/, items: ['🦴', '🐾', '🥣'], bg: '#F3EEE5' },
];

/** Rotated through for an aisle that matches no rule, so cards still differ (owner, 2026-10-18:
 * "give each different colors for the categories it will be good"). */
const FALLBACK_BG = ['#FFF1E6', '#EAF4FC', '#F6F3E3', '#FBEAF1', '#E7F6F1', '#EDEBFA'];

function matchRule(aisle: { name?: string | null; slug?: string | null }) {
  const text = `${aisle.name ?? ''} ${aisle.slug ?? ''}`.toLowerCase().replace(/[-_&]+/g, ' ');
  return RULES.find((r) => r.words.test(text));
}

/** Three illustrated items for this aisle, picked by name/slug keywords; the banner set otherwise. */
export function aisleArt(aisle: { name?: string | null; slug?: string | null }, seed = 0): [string, string, string] {
  const rule = matchRule(aisle);
  if (rule) return rule.items;
  // fallback: three neighbouring beam items, rotated by the card's position so cards differ
  const n = BEAM_ITEMS.length;
  const at = ((seed % n) + n) % n;
  return [BEAM_ITEMS[at], BEAM_ITEMS[(at + 1) % n], BEAM_ITEMS[(at + 2) % n]];
}

/** A soft, category-matched card background, a different one per aisle instead of one flat grey. */
export function aisleTint(aisle: { name?: string | null; slug?: string | null }, seed = 0): string {
  const rule = matchRule(aisle);
  if (rule) return rule.bg;
  const n = FALLBACK_BG.length;
  return FALLBACK_BG[((seed % n) + n) % n]!;
}

/** 0..3: where in the loop this card starts, so neighbouring cards never move in step. */
export function aislePhase(index: number): number {
  // golden-ratio spacing keeps any run of cards well apart
  const x = (index * 0.618034) % 1;
  return x * 3;
}
