import { describe, it, expect } from 'vitest';
import { diffFingerprints, type Fingerprint } from './setup/db-hygiene.js';

/**
 * The hygiene check's comparison (tests/setup/db-hygiene.ts): any added,
 * removed or changed row in any table is reported by table and row id, and
 * identical snapshots report nothing. Pure - no database.
 */
const snap = (tables: Record<string, Record<string, string>>): Fingerprint =>
  Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, { rows: Object.keys(rows).length, rowHashes: rows }]));

describe('DB hygiene comparison', () => {
  const before = snap({ users: { u1: 'a', u2: 'b' }, notifications: { n1: 'x' } });

  it('reports nothing for identical snapshots', () => {
    expect(diffFingerprints(before, snap({ users: { u1: 'a', u2: 'b' }, notifications: { n1: 'x' } }))).toEqual([]);
  });

  it('reports an added row with its id', () => {
    expect(diffFingerprints(before, snap({ users: { u1: 'a', u2: 'b' }, notifications: { n1: 'x', n2: 'y' } }))).toEqual([
      'notifications: rows 1 -> 2; added: n2',
    ]);
  });

  it('reports a removed row with its id', () => {
    expect(diffFingerprints(before, snap({ users: { u1: 'a' }, notifications: { n1: 'x' } }))).toEqual([
      'users: rows 2 -> 1; removed: u2',
    ]);
  });

  it('reports a changed row with its id, even when the count is unchanged', () => {
    expect(diffFingerprints(before, snap({ users: { u1: 'a', u2: 'CHANGED' }, notifications: { n1: 'x' } }))).toEqual([
      'users: rows 2 -> 2; changed: u2',
    ]);
  });

  it('reports a table that appeared or disappeared', () => {
    expect(diffFingerprints(before, snap({ users: { u1: 'a', u2: 'b' } }))).toEqual(['notifications: table removed']);
    expect(diffFingerprints(snap({ users: { u1: 'a', u2: 'b' } }), before)).toEqual(['notifications: table added']);
  });

  it('lists at most five ids per kind, then a count', () => {
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`n${i}`, 'x']));
    expect(diffFingerprints(snap({ notifications: {} }), snap({ notifications: many }))).toEqual([
      'notifications: rows 0 -> 8; added: n0, n1, n2, n3, n4 (+3 more)',
    ]);
  });
});
