/**
 * Small drawn illustrations in the Blynk palette (yellow fill, ink line,
 * white), used for empty states and the welcome card. No stock art, no
 * people. All decorative (aria-hidden): the words around them carry meaning.
 */
const INK = '#1A1D2E';
const Y = '#FFE141';
const YD = '#F2C600';
const TINT = '#FFF8D6';
const W = '#FFFFFF';

type Name = 'crate' | 'shopfront' | 'receipt' | 'wallet' | 'jar' | 'map';

export function Illustration({ name, className }: { name: Name; className?: string }) {
  const common = {
    className: `illo illo--${name}${className ? ` ${className}` : ''}`,
    'aria-hidden': true as const,
    focusable: false as const,
    fill: 'none',
    stroke: INK,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'crate':
      return (
        <svg viewBox="0 0 220 170" {...common}>
          <ellipse cx="110" cy="152" rx="78" ry="9" fill={INK} stroke="none" opacity="0.07" />
          {/* jars peeking out of the crate */}
          <g className="illo__float">
            <rect x="62" y="44" width="34" height="46" rx="9" fill={W} />
            <rect x="60" y="36" width="38" height="12" rx="4" fill={YD} />
            <path d="M70 62h18M70 70h12" opacity="0.5" />
          </g>
          <g className="illo__float illo__float--late">
            <rect x="104" y="30" width="40" height="60" rx="11" fill={Y} />
            <rect x="102" y="22" width="44" height="12" rx="4" fill={INK} />
            <circle cx="124" cy="62" r="9" fill={W} />
            <path d="m120 62 3 3 5-6" />
          </g>
          <g className="illo__float">
            <path d="M152 88c0-18 8-30 20-38-1 15-6 28-20 38Z" fill={TINT} />
            <path d="M152 88c3-12 9-22 18-36" />
          </g>
          {/* crate */}
          <path d="M44 84h132l-10 62H54L44 84Z" fill={Y} />
          <path d="M44 84h132v10H44z" fill={YD} />
          <path d="M58 108h104M60 126h100" opacity="0.35" />
          <path d="M86 94v50M134 94v50" opacity="0.35" />
          {/* sparkles */}
          <path className="illo__twinkle" d="M182 34v12M176 40h12" />
          <path className="illo__twinkle illo__twinkle--late" d="M36 50v8M32 54h8" />
          <circle cx="190" cy="74" r="3" fill={INK} stroke="none" opacity="0.2" />
        </svg>
      );
    case 'shopfront':
      return (
        <svg viewBox="0 0 240 190" {...common}>
          <ellipse cx="120" cy="176" rx="96" ry="9" fill={INK} stroke="none" opacity="0.1" />
          {/* building */}
          <rect x="40" y="62" width="160" height="110" rx="10" fill={W} />
          {/* awning */}
          <path d="M32 62h176l-8 26H40l-8-26Z" fill={INK} />
          <path
            d="M40 88c0 9 6 14 13 14s13-5 13-14c0 9 6 14 13 14s13-5 13-14c0 9 6 14 13 14s13-5 13-14c0 9 6 14 13 14s13-5 13-14c0 9 6 14 13 14s13-5 13-14c0 9 6 14 13 14s13-5 13-14"
            fill={Y}
          />
          <path d="M53 62l-6 26M79 62l-4 26M105 62l-2 26M131 62l2 26M157 62l4 26M183 62l6 26" stroke={Y} opacity="0.5" />
          {/* window with goods */}
          <rect x="56" y="114" width="70" height="44" rx="6" fill={TINT} />
          <rect x="64" y="130" width="14" height="20" rx="4" fill={Y} />
          <rect x="82" y="124" width="14" height="26" rx="4" fill={W} />
          <rect x="100" y="134" width="16" height="16" rx="4" fill={YD} />
          {/* door */}
          <rect x="140" y="112" width="44" height="60" rx="6" fill={Y} />
          <circle cx="174" cy="144" r="2.5" fill={INK} stroke="none" />
          <rect x="146" y="120" width="32" height="14" rx="3" fill={W} />
          <path d="M152 127h20" opacity="0.4" />
          {/* sign */}
          <rect x="84" y="36" width="72" height="20" rx="10" fill={Y} />
          <path d="M98 46h44" />
          {/* floating map pin */}
          <g className="illo__float">
            <path d="M206 20c-11 0-19 8-19 18 0 13 19 30 19 30s19-17 19-30c0-10-8-18-19-18Z" fill={Y} />
            <circle cx="206" cy="38" r="6.5" fill={W} />
          </g>
          <path className="illo__twinkle" d="M24 34v10M19 39h10" />
        </svg>
      );
    case 'receipt':
      return (
        <svg viewBox="0 0 160 130" {...common}>
          <ellipse cx="80" cy="120" rx="52" ry="6" fill={INK} stroke="none" opacity="0.07" />
          <path d="M48 14h64v96l-8-6-8 6-8-6-8 6-8-6-8 6-8-6-8 6V14Z" fill={W} />
          <path d="M60 34h40M60 48h28M60 62h36" opacity="0.4" />
          <rect x="60" y="76" width="40" height="12" rx="6" fill={Y} />
          <circle className="illo__float" cx="122" cy="34" r="12" fill={Y} />
          <path className="illo__float" d="M118 34h8M122 30v8" />
          <path className="illo__twinkle" d="M32 40v8M28 44h8" />
        </svg>
      );
    case 'wallet':
      return (
        <svg viewBox="0 0 160 130" {...common}>
          <ellipse cx="80" cy="120" rx="52" ry="6" fill={INK} stroke="none" opacity="0.07" />
          <g className="illo__float">
            <circle cx="104" cy="30" r="15" fill={Y} />
            <circle cx="104" cy="30" r="9" fill={YD} stroke="none" />
            <path d="M104 25v10" />
          </g>
          <rect x="34" y="46" width="92" height="64" rx="12" fill={INK} stroke="none" />
          <rect x="34" y="46" width="92" height="20" rx="10" fill={Y} />
          <rect x="94" y="72" width="40" height="22" rx="8" fill={W} />
          <circle cx="106" cy="83" r="3.5" fill={INK} stroke="none" />
          <path className="illo__twinkle" d="M30 26v8M26 30h8" />
        </svg>
      );
    case 'jar':
      return (
        <svg viewBox="0 0 120 90" {...common} strokeWidth={1.8}>
          <ellipse cx="60" cy="80" rx="30" ry="4" fill={INK} stroke="none" opacity="0.08" />
          <rect x="40" y="26" width="40" height="52" rx="11" fill={W} />
          <rect x="37" y="16" width="46" height="13" rx="4" fill={YD} />
          <rect x="47" y="44" width="26" height="16" rx="5" fill={Y} />
          <path d="M84 30c0-9 5-15 12-18-1 8-4 14-12 18Z" fill={TINT} />
        </svg>
      );
    case 'map':
      return (
        <svg viewBox="0 0 160 130" {...common}>
          <path d="M22 34 58 22l44 12 36-12v74l-36 12-44-12-36 12V34Z" fill={W} />
          <path d="M58 22v74M102 34v74" opacity="0.25" />
          <path d="M30 70c20-6 30 8 50 0s34-18 52-6" stroke={YD} strokeWidth="5" opacity="0.7" />
          <g className="illo__float">
            <path d="M80 18c-12 0-21 9-21 20 0 15 21 34 21 34s21-19 21-34c0-11-9-20-21-20Z" fill={Y} />
            <circle cx="80" cy="38" r="7" fill={W} />
          </g>
        </svg>
      );
  }
}
