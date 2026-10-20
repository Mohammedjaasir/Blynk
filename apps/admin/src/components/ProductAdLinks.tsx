import { useState } from 'react';
import { useToast } from './ui';

/**
 * Links to put in a YouTube / Instagram / Facebook / TikTok ad or post (owner, 2026-10-20: "if
 * some customer comes through youtube insta we have to show the product ad in the app").
 * blynk.lk/p/<id> opens the Blynk app straight on this product; the utm tags tell Google
 * Analytics which ad or post the visitor came from.
 */
export const SHOP_URL = (import.meta.env.VITE_SHOP_URL as string | undefined)?.replace(/\/$/, '') || 'https://blynk.lk';

export const AD_SOURCES = [
  { key: 'instagram', label: 'Instagram', medium: 'social' },
  { key: 'facebook', label: 'Facebook', medium: 'social' },
  { key: 'youtube', label: 'YouTube', medium: 'video' },
  { key: 'tiktok', label: 'TikTok', medium: 'social' },
  { key: 'whatsapp', label: 'WhatsApp', medium: 'chat' },
] as const;

const campaignOf = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'product';

export function productAdLink(productId: string, productName: string, source: (typeof AD_SOURCES)[number]) {
  const q = new URLSearchParams({ utm_source: source.key, utm_medium: source.medium, utm_campaign: campaignOf(productName) });
  return `${SHOP_URL}/p/${encodeURIComponent(productId)}?${q.toString()}`;
}

export function ProductAdLinks({ productId, productName }: { productId: string; productName: string }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  async function copy(url: string, label: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} link copied.`);
    } catch {
      setError('Could not copy. Select the link and copy it.');
    }
  }

  return (
    <section className="form__section" aria-label="Ad links">
      <h2 className="form__section-title">Ad links</h2>
      <p className="form__note">
        Put one of these links in a YouTube, Instagram, Facebook or TikTok ad or post. It opens the Blynk app straight on
        this product, and Google Analytics shows which one people came from.
      </p>
      <div className="ad-links">
        {AD_SOURCES.map((source) => {
          const url = productAdLink(productId, productName, source);
          return (
            <div className="ad-links__row" key={source.key}>
              <span className="field__label">{source.label}</span>
              <input
                className="input"
                readOnly
                value={url}
                aria-label={`${source.label} link`}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="button button--ghost" onClick={() => void copy(url, source.label)}>
                Copy
              </button>
            </div>
          );
        })}
      </div>
      <p className="form__note">
        <a href={`${SHOP_URL}/p/${encodeURIComponent(productId)}`} target="_blank" rel="noopener noreferrer">
          Open this product in the app
        </a>
      </p>
      {error ? <p className="field__error">{error}</p> : null}
    </section>
  );
}
