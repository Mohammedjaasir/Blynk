import { describe, it, expect } from 'vitest';
import {
  hasCampaignTags,
  lastScanText,
  leavesBlynk,
  qrCodeProblem,
  qrFileName,
  qrLinkProblems,
  qrLinksPayload,
  qrPngDataUrl,
  qrShortAddress,
  qrSvg,
  qrUrlProblem,
  withCampaignTags,
  withoutCampaignTags,
} from '../lib/qrLinks';

/** The client-side rules mirror backend/api/src/modules/configuration/qr-links.ts. */
describe('QR link rules', () => {
  it('accepts codes of 1-24 lowercase letters, digits and inner dashes', () => {
    for (const ok of ['j', 'jersey', 'table-1', 'a1', '0', 'a'.repeat(24), 'a-b-c']) expect(qrCodeProblem(ok)).toBeNull();
    // Typed capitals are lowercased before the check, like the server does.
    expect(qrCodeProblem(' Jersey ')).toBeNull();
  });

  it('refuses empty, over-long, dashed-at-the-ends and odd-character codes', () => {
    for (const bad of ['', '  ', '-a', 'a-', 'a'.repeat(25), 'a b', 'a_b', 'a/b', 'ஜெ', '-']) expect(qrCodeProblem(bad), bad).not.toBeNull();
  });

  it('refuses a code already in the list', () => {
    expect(qrCodeProblem('J', ['j'])).toBe('The code "j" is already used');
    expect(qrCodeProblem('k', ['j'])).toBeNull();
  });

  it('requires https with a real host and no sign-in', () => {
    expect(qrUrlProblem('https://blynk.lk/app/?a=1')).toBeNull();
    expect(qrUrlProblem('  https://wa.me/94771234567  ')).toBeNull();
    expect(qrUrlProblem('http://blynk.lk')).toBe('The address must start with https://');
    expect(qrUrlProblem('blynk.lk')).toMatch(/full web address/);
    expect(qrUrlProblem('https://localhost')).toMatch(/full web address/);
    expect(qrUrlProblem('javascript:alert(1)')).toBe('The address must start with https://');
    expect(qrUrlProblem('https://user:pw@blynk.lk')).toBe('The address cannot contain a sign-in');
    expect(qrUrlProblem(`https://blynk.lk/${'a'.repeat(500)}`)).toMatch(/At most 500/);
  });

  it('checks every field of a link', () => {
    expect(qrLinkProblems({ code: 'j', label: 'Jersey', url: 'https://blynk.lk/app/' })).toEqual({});
    expect(Object.keys(qrLinkProblems({ code: '-', label: ' ', url: 'nope' })).sort()).toEqual(['code', 'label', 'url']);
    expect(qrLinkProblems({ code: 'j', label: 'x'.repeat(41), url: 'https://blynk.lk' }).label).toMatch(/At most 40/);
  });
});

describe('QR link helpers', () => {
  it('the QR carries the short address, never the destination', () => {
    expect(qrShortAddress('j')).toBe('https://blynk.lk/q/j');
    expect(qrFileName('j', 'svg')).toBe('blynk-qr-j.svg');
    expect(qrFileName('j', 'png')).toBe('blynk-qr-j.png');
  });

  it('knows when a destination leaves blynk.lk', () => {
    expect(leavesBlynk('https://blynk.lk/app/')).toBe(false);
    expect(leavesBlynk('https://www.blynk.lk/')).toBe(false);
    expect(leavesBlynk('https://example.com')).toBe(true);
    expect(leavesBlynk('https://blynk.lk.evil.com')).toBe(true);
    expect(leavesBlynk('not a url')).toBe(false);
  });

  it('adds the campaign tags where missing and removes them again', () => {
    const tagged = withCampaignTags('https://blynk.lk/app/', 'J');
    expect(tagged).toBe('https://blynk.lk/app/?utm_source=j&utm_medium=qr&utm_campaign=j');
    expect(hasCampaignTags(tagged)).toBe(true);
    expect(withCampaignTags(tagged, 'j')).toBe(tagged);
    expect(withCampaignTags('https://blynk.lk/app/?utm_source=poster', 'j')).toBe('https://blynk.lk/app/?utm_source=poster&utm_medium=qr&utm_campaign=j');
    expect(withoutCampaignTags(tagged)).toBe('https://blynk.lk/app/');
    expect(hasCampaignTags('https://blynk.lk/app/')).toBe(false);
    expect(withCampaignTags('nonsense', 'j')).toBe('nonsense');
  });

  it('writes the last scan in Sri Lanka time', () => {
    expect(lastScanText(null)).toBe('No scans yet');
    expect(lastScanText('2026-10-21T08:30:00.000Z')).toBe('21 Oct 2026, 14:00 (Sri Lanka time)');
    expect(lastScanText('2026-10-21T20:00:00.000Z')).toBe('22 Oct 2026, 01:30 (Sri Lanka time)');
  });

  it('the payload is trimmed and lowercased and nothing else', () => {
    expect(qrLinksPayload([{ code: ' J ', label: ' Jersey ', url: ' https://blynk.lk/app/ ' }])).toEqual({
      links: [{ code: 'j', label: 'Jersey', url: 'https://blynk.lk/app/' }],
    });
  });

  it('draws dark on white with a quiet zone, as SVG and as a 1600px PNG', async () => {
    const svg = await qrSvg('j');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('#12151F');
    expect(svg).toContain('#FFFFFF');
    const png = await qrPngDataUrl('j');
    expect(png.startsWith('data:image/png;base64,')).toBe(true);
    // PNG header carries the width at bytes 16-19.
    const bytes = Uint8Array.from(atob(png.split(',')[1]!), (c) => c.charCodeAt(0));
    expect((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!).toBe(1600);
  });
});
