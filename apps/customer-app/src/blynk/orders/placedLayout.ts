/**
 * Geometry of the "Order placed!" screen: one centred column that both cards and the buttons
 * share (same left and right edges at every phone width), and a smaller check on short phones.
 */
export const PLACED_LAYOUT = { gutter: 24, maxColumn: 360, check: 120, checkShort: 100, shortBelow: 700, mascotMax: 84, mascotGap: 6 } as const;

export function placedLayout(width: number, height: number) {
  const L = PLACED_LAYOUT;
  const column = Math.max(0, Math.min(width - L.gutter * 2, L.maxColumn));
  const check = height < L.shortBelow ? L.checkShort : L.check;
  // the rider stops in the space left of the check, never over it
  const side = (column - check) / 2;
  const mascot = Math.max(0, Math.min(L.mascotMax, Math.floor(side - L.mascotGap)));
  return { column, check, mascot, mascotLeft: Math.max(0, side - L.mascotGap - mascot) };
}
