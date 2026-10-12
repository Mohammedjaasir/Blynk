import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import { errorMessage } from '../lib/errors';

/**
 * Owner, 2026-10-12: staff cannot record cash, change pay or adjust points
 * for their own account. The API answers 403 CANNOT_RECORD_FOR_SELF with a
 * friendly sentence; Ops shows that sentence, not the generic 403 text.
 */
describe('CANNOT_RECORD_FOR_SELF', () => {
  it("shows the server's own words", () => {
    const message = "You can't record cash or pay for your own account. Please ask another staff member to do it.";
    expect(errorMessage(new ApiError(message, 403, 'CANNOT_RECORD_FOR_SELF'))).toBe(message);
    const points = "You can't record points for your own account. Please ask another staff member to do it.";
    expect(errorMessage(new ApiError(points, 403, 'CANNOT_RECORD_FOR_SELF'))).toBe(points);
  });

  it('falls back to a clear sentence when the server sent none', () => {
    expect(errorMessage(new ApiError('', 403, 'CANNOT_RECORD_FOR_SELF'))).toMatch(/another staff member/);
  });

  it('other 403s keep the generic text', () => {
    expect(errorMessage(new ApiError('Forbidden', 403, 'FORBIDDEN'))).toBe('Your account is not allowed to do this.');
  });
});
