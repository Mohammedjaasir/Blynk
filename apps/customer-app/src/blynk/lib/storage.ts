/**
 * Key-value storage: localStorage on the web, an in-memory map elsewhere
 * (native, private windows, blocked storage). Never throws.
 */
const memory = new Map<string, string>();

function web(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

export const storage = {
  get(key: string): string | null {
    const ls = web();
    if (ls) {
      try { return ls.getItem(key); } catch { /* blocked: fall through */ }
    }
    return memory.has(key) ? (memory.get(key) as string) : null;
  },
  set(key: string, value: string): void {
    const ls = web();
    if (ls) {
      try { ls.setItem(key, value); return; } catch { /* full or blocked: fall through */ }
    }
    memory.set(key, value);
  },
};
