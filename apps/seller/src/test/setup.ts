import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Slow machines: wait longer for screens to appear before a test fails.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no object URLs (the photo preview uses them).
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* ignored */
  }
});
