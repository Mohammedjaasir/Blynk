// Product ad links (owner, 2026-10-20): a link per platform that opens the app on the product,
// tagged so Google Analytics knows which ad or post the visitor came from.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductAdLinks, productAdLink, AD_SOURCES } from '../components/ProductAdLinks';

const ID = '8c3ab1e9-4900-4541-9547-1ad6ec2bd223';

afterEach(() => vi.restoreAllMocks());

describe('ProductAdLinks', () => {
  it('builds a blynk.lk/p link with utm tags for each platform', () => {
    const url = new URL(productAdLink(ID, 'Baby Care Diapers 4Pcs Pack', AD_SOURCES[0]));
    expect(url.origin + url.pathname).toBe(`https://blynk.lk/p/${ID}`);
    expect(url.searchParams.get('utm_source')).toBe('instagram');
    expect(url.searchParams.get('utm_medium')).toBe('social');
    expect(url.searchParams.get('utm_campaign')).toBe('baby-care-diapers-4pcs-pack');
  });

  it('shows one link per platform and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(
      <ProductAdLinks productId={ID} productName="Farm Fresh Brown Eggs" />
    );
    for (const s of ['Instagram', 'Facebook', 'YouTube', 'TikTok', 'WhatsApp']) {
      expect((screen.getByLabelText(`${s} link`) as HTMLInputElement).value).toContain(`/p/${ID}?utm_source=`);
    }
    await user.click(screen.getAllByRole('button', { name: 'Copy' })[2]);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('utm_source=youtube'));
    expect(await screen.findByText('YouTube link copied.')).toBeInTheDocument();
  });
});
