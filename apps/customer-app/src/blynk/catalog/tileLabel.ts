/*
 * The one small label a product tile may carry besides its price (clean pass, 2026-10-14:
 * "make it more clean minimal"). Priority: sold out > offer > lead time. A sold-out tile's label
 * is the "Sold out" chip on its photo; an offer whose struck regular price is showing needs no
 * caption (the struck price says it), so the lead time may show there. Pure.
 */
export type TileLabel = { kind: 'offer' | 'lead'; text: string } | null;

export const TILE_COPY = { offer: 'Offer price' } as const;

export function tileLabel(t: {
  available: boolean;
  offer: boolean;
  /** The regular price is shown struck through beside the offer price. */
  struckShown: boolean;
  /** "Delivered from Fri 17 Oct", or null. */
  lead: string | null;
}): TileLabel {
  if (!t.available) return null;
  if (t.offer && !t.struckShown) return { kind: 'offer', text: TILE_COPY.offer };
  if (t.lead) return { kind: 'lead', text: t.lead };
  return null;
}
