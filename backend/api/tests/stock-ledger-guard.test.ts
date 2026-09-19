import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * No stock movement outside the canonical stock writer (inventory plan §5,
 * Task 2). Only src/modules/inventory/stock-ledger.ts may change
 * inventory.quantity_on_hand / quantity_reserved or append to
 * inventory_adjustments, so every movement has exactly one ledger row with
 * correct before/after values. Seeds are excluded (they create rows at 0).
 */
const SRC = join(__dirname, '..', 'src');
const WRITER = 'modules/inventory/stock-ledger.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const files = sourceFiles(SRC)
  .map((full) => ({ rel: relative(SRC, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }))
  .filter((f) => f.rel !== WRITER && !f.rel.startsWith('database/seeds/'));

/** `.updateTable('inventory')` statements (up to the next `.execute`) that set a quantity. */
function quantityUpdates(text: string): string[] {
  const hits: string[] = [];
  const re = /updateTable\(\s*['"]inventory['"]\s*\)([\s\S]*?)\.execute/g;
  for (const m of text.matchAll(re)) {
    if (/\bquantity_(on_hand|reserved)\s*:/.test(m[1])) hits.push(m[0].slice(0, 120));
  }
  return hits;
}

describe('stock ledger: no bypass', () => {
  it('nothing outside the stock writer changes inventory quantities', () => {
    const offenders = files.flatMap((f) => quantityUpdates(f.text).map((hit) => `${f.rel}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it('nothing outside the stock writer appends to the ledger', () => {
    const offenders = files
      .filter((f) => /insertInto\(\s*['"]inventory_adjustments['"]\s*\)|INSERT\s+INTO\s+inventory_adjustments\b/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('no raw SQL updates inventory', () => {
    // Case-sensitive: SQL keywords are capitalised in this codebase.
    const offenders = files.filter((f) => /UPDATE\s+inventory\b/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('the stock writer exists and is the one place that does both', () => {
    const writer = readFileSync(join(SRC, WRITER), 'utf8');
    expect(quantityUpdates(writer).length).toBeGreaterThan(0);
    expect(writer).toMatch(/insertInto\(\s*['"]inventory_adjustments['"]\s*\)/);
  });
});
