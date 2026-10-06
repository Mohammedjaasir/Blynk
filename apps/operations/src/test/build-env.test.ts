import { describe, expect, it } from 'vitest';
import { apiBaseUrlProblem } from '../lib/build-env';

describe('production build guard for VITE_API_BASE_URL', () => {
  it('accepts a real https API address', () => {
    expect(apiBaseUrlProblem('https://api.blynk.lk/api/v1')).toBeNull();
  });

  it.each([undefined, '', '   '])('refuses a missing address (%j)', (value) => {
    expect(apiBaseUrlProblem(value)).toMatch(/not set/);
  });

  it.each([
    'http://localhost:4000/api/v1',
    'https://localhost/api/v1',
    'http://127.0.0.1:4000/api/v1',
    'http://10.0.2.2:4000/api/v1',
    'http://[::1]:4000/api/v1',
  ])('refuses an address on the build machine (%s)', (value) => {
    expect(apiBaseUrlProblem(value)).toMatch(/points at this computer/);
  });

  it('refuses plain http to a public host', () => {
    expect(apiBaseUrlProblem('http://api.blynk.lk/api/v1')).toMatch(/https/);
  });

  it('refuses something that is not a URL, and explains how to build', () => {
    expect(apiBaseUrlProblem('api.blynk.lk')).toMatch(/not a valid URL[\s\S]*npm run build && npx cap sync android/);
  });

  it('allows http to a private LAN IPv4 only for the LAN test build (CAP_LAN_HTTP=1)', () => {
    expect(apiBaseUrlProblem('http://192.168.1.50:4000/api/v1')).not.toBeNull();
    expect(apiBaseUrlProblem('http://192.168.1.50:4000/api/v1', { lanHttp: true })).toBeNull();
    expect(apiBaseUrlProblem('http://172.20.0.5:4000/api/v1', { lanHttp: true })).toBeNull();
    expect(apiBaseUrlProblem('http://8.8.8.8/api/v1', { lanHttp: true })).not.toBeNull();
    expect(apiBaseUrlProblem('http://localhost:4000/api/v1', { lanHttp: true })).not.toBeNull();
  });
});
