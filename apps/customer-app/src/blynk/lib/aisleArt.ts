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
const RULES: { words: RegExp; items: [string, string, string] }[] = [
  // fruit and vegetables first: "veggies" must not fall into the dairy rule
  { words: /fruit/, items: ['🍎', '🍌', '🍊'] },
  { words: /\bveg|greens|produce/, items: ['🥦', '🥕', '🍅'] },
  { words: /dairy|milk|\beggs?\b|butter|cheese|yog(h)?urt|curd/, items: ['🥛', '🥚', '🧀'] },
  { words: /bak(e|ery)|bread|\bbuns?\b|biscuit|cookie|cracker|cake/, items: ['🍞', '🍪', '🥐'] },
  { words: /rice|grocer|grain|dhal|\bdal\b|pulse|lentil|flour|staple/, items: ['🍚', '🌾', '🥥'] },
  { words: /spice|masala|chilli|chili|curry/, items: ['🌶️', '🧄', '🧅'] },
  { words: /\boils?\b|sugar|salt/, items: ['🥥', '🧂', '🍯'] },
  { words: /meat|chicken|poultry|mutton|beef/, items: ['🍗', '🥩', '🍖'] },
  { words: /fish|sea ?food|prawn|shrimp/, items: ['🐟', '🦐', '🦀'] },
  { words: /\btea\b|coffee/, items: ['🍵', '☕', '🍪'] },
  { words: /beverage|drink|juice|water|soda/, items: ['🧃', '🥤', '🥥'] },
  { words: /snack|chip|sweet|chocolate|candy|confection/, items: ['🍫', '🍬', '🍿'] },
  { words: /frozen|ice ?cream/, items: ['🍦', '🧊', '🍨'] },
  { words: /baby|infant|kid/, items: ['🍼', '🧸', '🧷'] },
  { words: /household|clean|laundry|detergent|home care|kitchen/, items: ['🧽', '🧴', '🧹'] },
  { words: /personal|beauty|cosmetic|care|hygiene|bath|soap/, items: ['🧴', '🧼', '🧻'] },
  { words: /\bpets?\b/, items: ['🦴', '🐾', '🥣'] },
];

/** Three illustrated items for this aisle, picked by name/slug keywords; the banner set otherwise. */
export function aisleArt(aisle: { name?: string | null; slug?: string | null }, seed = 0): [string, string, string] {
  const text = `${aisle.name ?? ''} ${aisle.slug ?? ''}`.toLowerCase().replace(/[-_&]+/g, ' ');
  for (const r of RULES) if (r.words.test(text)) return r.items;
  // fallback: three neighbouring beam items, rotated by the card's position so cards differ
  const n = BEAM_ITEMS.length;
  const at = ((seed % n) + n) % n;
  return [BEAM_ITEMS[at], BEAM_ITEMS[(at + 1) % n], BEAM_ITEMS[(at + 2) % n]];
}

/** 0..3: where in the loop this card starts, so neighbouring cards never move in step. */
export function aislePhase(index: number): number {
  // golden-ratio spacing keeps any run of cards well apart
  const x = (index * 0.618034) % 1;
  return x * 3;
}
