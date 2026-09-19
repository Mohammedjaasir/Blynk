import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * No bypass of the canonical order lifecycle (plan §O.1). Only
 * src/modules/orders/lifecycle/ may change orders.order_status or write
 * order_status_history; order creation may insert an order, and only with the
 * lifecycle's initial status. This is a static check over the source so a new
 * endpoint cannot quietly reintroduce a direct status update.
 */
const SRC = join(__dirname, '..', 'src');
const LIFECYCLE = join('modules', 'orders', 'lifecycle');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const files = sourceFiles(SRC)
  .map((full) => ({ rel: relative(SRC, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }))
  .filter((f) => !f.rel.startsWith(LIFECYCLE.split(sep).join('/')));

/** `.updateTable('orders')` statements (up to the next `.execute`) that set order_status. */
function statusUpdates(text: string): string[] {
  const hits: string[] = [];
  const re = /updateTable\(\s*['"]orders['"]\s*\)([\s\S]*?)\.execute/g;
  for (const m of text.matchAll(re)) {
    if (/\border_status\s*:/.test(m[1])) hits.push(m[0].slice(0, 120));
  }
  return hits;
}

describe('order lifecycle: no bypass', () => {
  it('nothing outside the lifecycle sets orders.order_status', () => {
    const offenders = files.flatMap((f) => statusUpdates(f.text).map((hit) => `${f.rel}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it('nothing outside the lifecycle writes order_status_history', () => {
    const offenders = files.filter((f) => /insertInto\(\s*['"]order_status_history['"]\s*\)/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('no raw SQL updates orders', () => {
    // SQL keywords are written in capitals in this codebase; case-sensitive so
    // a prose comment ("update orders ...") is not mistaken for SQL.
    const offenders = files.filter((f) => /UPDATE\s+orders\b/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('orders are inserted only by order creation, with the lifecycle initial status', () => {
    const inserting = files.filter((f) => /insertInto\(\s*['"]orders['"]\s*\)/.test(f.text));
    expect(inserting.map((f) => f.rel)).toEqual(['modules/orders/order.repository.ts']);
    const repo = inserting[0].text;
    expect(repo).toMatch(/order_status:\s*INITIAL_ORDER_STATUS/);
    expect(repo).not.toMatch(/order_status:\s*'PLACED'/);
  });
});
