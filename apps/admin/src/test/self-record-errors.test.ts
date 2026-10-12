import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import { errorMessage } from '../lib/apiErrors';

/**
 * Owner, 2026-10-12: staff cannot record cash, change pay or adjust points
 * for their own account. The API answers 403 CANNOT_RECORD_FOR_SELF with a
 * friendly sentence; Admin shows that sentence.
 */
describe('CANNOT_RECORD_FOR_SELF', () => {
  it("shows the server's own words", () => {
    const message = "You can't record cash or pay for your own account. Please ask another staff member to do it.";
    expect(errorMessage(new ApiError(message, 403, 'CANNOT_RECORD_FOR_SELF'), 'Could not record the hand-in.')).toBe(message);
  });

  it('falls back to a clear sentence when the server sent none', () => {
    expect(errorMessage(new ApiError('', 403, 'CANNOT_RECORD_FOR_SELF'), 'Could not record the hand-in.')).toMatch(
      /another staff member/
    );
  });
});
