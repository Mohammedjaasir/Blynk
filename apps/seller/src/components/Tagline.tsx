import { IconPin } from './icons';

/** Blynk Sellers is only open in one town for now; the sign-in page and the home screen say so. */
export const TAGLINE = 'Open to sellers in Dharga Town only, for now.';

export function Tagline({ className = '' }: { className?: string }) {
  return (
    <p className={`tagline${className ? ` ${className}` : ''}`} data-testid="tagline">
      <IconPin size={15} /> <span>{TAGLINE}</span>
    </p>
  );
}
