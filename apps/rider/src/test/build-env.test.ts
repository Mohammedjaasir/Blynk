import { describe, expect, it } from 'vitest';
import { assertProductionEnv, productionApiProblem } from '../build-env';

describe('production build guard (vite.config.ts)', () => {
  it.each([
    [undefined, /not set/],
    ['', /not set/],
    ['   ', /not set/],
    ['not a url', /not a valid URL/],
    ['http://api.blynk.lk/api/v1', /https/],
    ['http://localhost:4000/api/v1', /https/],
    ['https://localhost:4000/api/v1', /this machine/],
    ['https://127.0.0.1/api/v1', /this machine/],
    ['https://[::1]/api/v1', /this machine/],
    ['https://api.localhost/api/v1', /this machine/],
  ])('refuses %j', (value, problem) => {
    expect(productionApiProblem(value)).toMatch(problem);
    expect(() => assertProductionEnv({ VITE_API_BASE_URL: value })).toThrow(/vite build --mode development/);
  });

  it('accepts a public https API', () => {
    expect(productionApiProblem('https://api.blynk.lk/api/v1')).toBeNull();
    expect(() => assertProductionEnv({ VITE_API_BASE_URL: 'https://api.blynk.lk/api/v1' })).not.toThrow();
  });
});
