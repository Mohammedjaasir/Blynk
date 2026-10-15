import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { size?: number; color?: string; stroke?: number };

export const SearchIcon = ({ size = 18, color = '#555', stroke = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={stroke} />
    <Path d="M20 20l-3.5-3.5" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
  </Svg>
);

export const BackIcon = ({ size = 22, color = '#222', stroke = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M20 12H5M11 5l-7 7 7 7" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ChevronIcon = ({ size = 16, color = '#444', stroke = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const ArrowRight = ({ size = 14, color = '#222', stroke = 2.4 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 12h15M13 6l6 6-6 6" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const NavIcon = ({ size = 16, color = '#222' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M21 3L3 10.5l7.5 3 3 7.5L21 3z" fill={color} />
  </Svg>
);

/** Three equal bars, as on the reference's home header. */
export const MenuIcon = ({ size = 22, color = '#fff', stroke = 2.2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 5h18M3 12h18M3 19h18" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
  </Svg>
);

export const CartIcon = ({ size = 16, color = '#fff' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 4h2.5l2.2 11h10.6L20.5 7H7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={9.5} cy={19.5} r={1.6} fill={color} />
    <Circle cx={17} cy={19.5} r={1.6} fill={color} />
  </Svg>
);

export const CloseIcon = ({ size = 12, color = '#fff', stroke = 2.4 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
  </Svg>
);

export const FilterIcon = ({ size = 16, color = '#444' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Circle cx={16} cy={7} r={2} stroke={color} strokeWidth={2} />
    <Circle cx={10} cy={17} r={2} stroke={color} strokeWidth={2} />
  </Svg>
);

export const ShareIcon = ({ size = 16, color = '#222' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 15V3M7 8l5-5 5 5M5 13v6h14v-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const BagIcon = ({ size = 20, color = '#fff' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={5} y={7} width={14} height={14} rx={3} stroke={color} strokeWidth={2} />
    <Path d="M9 7V5a3 3 0 016 0v2" stroke={color} strokeWidth={2} />
  </Svg>
);

/** Food-standard veg mark: stays green on purpose (not a brand colour). */
export const VegMark = ({ color = '#0B9A2C', size = 11 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Rect x={0.75} y={0.75} width={10.5} height={10.5} rx={2} fill="none" stroke={color} strokeWidth={1.3} />
    <Circle cx={6} cy={6} r={2.8} fill={color} />
  </Svg>
);

export const PinIcon = ({ size = 34, color = '#1A1D2E' }: P) => (
  <Svg width={size} height={size * 1.25} viewBox="0 0 32 40">
    <Path d="M16 39c0 0 13-14.5 13-24A13 13 0 003 15c0 9.5 13 24 13 24z" fill={color} />
    <Circle cx={16} cy={15} r={5.5} fill="#fff" />
  </Svg>
);

/** Cross-hair "locate" mark (location permission bar). */
export const LocateIcon = ({ size = 16, color = '#fff', stroke = 1.8 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={7.5} stroke={color} strokeWidth={stroke} />
    <Circle cx={12} cy={12} r={2.6} fill={color} />
    <Path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
  </Svg>
);

/** Filled five-point star. */
export const StarIcon = ({ size = 10, color = '#1A1D2E' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2.2l2.95 6.3 6.85.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8-5.1-4.7 6.85-.8z" fill={color} />
  </Svg>
);

/** White star in a filled circle (store rating row). */
export const StarBadge = ({ size = 13, color = '#1A1D2E' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={12} fill={color} />
    <Path d="M12 5.2l2 4.2 4.6.55-3.4 3.15.95 4.55L12 15.4l-4.15 2.25.95-4.55-3.4-3.15 4.6-.55z" fill="#fff" />
  </Svg>
);

/** White shopping bag in a filled circle (an aisle's item-count row, live mode). */
export const BagBadge = ({ size = 13, color = '#1A1D2E' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={12} fill={color} />
    <Rect x={7} y={9.5} width={10} height={8.5} rx={2} fill="#fff" />
    <Path d="M9.6 10V8.4a2.4 2.4 0 014.8 0V10" stroke="#fff" strokeWidth={1.6} fill="none" />
  </Svg>
);

/** Scalloped discount seal with a "%" (free-delivery row). */
export const OfferBadge = ({ size = 13, color = '#1A1D2E' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 1l2.4 1.9 3-.4 1.1 2.9 2.9 1.1-.4 3L23 12l-1.9 2.4.4 3-2.9 1.1-1.1 2.9-3-.4L12 23l-2.4-1.9-3 .4-1.1-2.9-2.9-1.1.4-3L1 12l1.9-2.4-.4-3 2.9-1.1 1.1-2.9 3 .4z"
      fill={color}
    />
    <Path d="M8.5 15.5l7-7" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
    <Circle cx={9} cy={9} r={1.5} fill="#fff" />
    <Circle cx={15} cy={15} r={1.5} fill="#fff" />
  </Svg>
);

/**
 * The reference's "eyes" mark (29 x 20): two round eyes glancing left; `filled` turns the
 * pupils into hearts ("Our app"). `size` is the height.
 */
export const HeartsIcon = ({ size = 14, color = '#1A1D2E', filled = false, pupil = '#3A3A40' }: P & { filled?: boolean; pupil?: string }) => {
  const heart = (cx: number, cy: number) =>
    `M${cx} ${cy + 3.6}c-2.6-1.7-4.3-3.3-4.3-5.2a2.15 2.15 0 0 1 4.3-.6a2.15 2.15 0 0 1 4.3.6c0 1.9-1.7 3.5-4.3 5.2z`;
  return (
    <Svg width={size * 1.45} height={size} viewBox="0 0 29 20">
      <Circle cx={9.6} cy={10} r={8.6} fill="#fff" stroke={color} strokeWidth={1.7} />
      <Circle cx={19.4} cy={10} r={8.6} fill="#fff" stroke={color} strokeWidth={1.7} />
      {filled ? (
        <>
          <Path d={heart(9.6, 10.4)} fill={color} />
          <Path d={heart(19.4, 10.4)} fill={color} />
        </>
      ) : (
        <>
          <Circle cx={7.6} cy={10.6} r={3.9} fill={pupil} />
          <Circle cx={17.4} cy={10.6} r={3.9} fill={pupil} />
        </>
      )}
    </Svg>
  );
};

/** Non-veg mark: triangle in a rounded square. */
export const NonVegMark = ({ color = '#D8344A', size = 11 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Rect x={0.75} y={0.75} width={10.5} height={10.5} rx={2} fill="none" stroke={color} strokeWidth={1.3} />
    <Path d="M6 3l3 5.2H3z" fill={color} />
  </Svg>
);

/** Outlined check box (promo band). */
export const CheckBoxIcon = ({ size = 14, color = '#FFE141', stroke = 2 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={2.5} y={2.5} width={19} height={19} rx={4} stroke={color} strokeWidth={stroke} />
    <Path d="M7 12.5l3.2 3.2L17 8.6" stroke={color} strokeWidth={stroke + 0.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

/** Two sliders (the first filter chip). */
export const SlidersIcon = ({ size = 16, color = '#333' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 8h11M20 8h1M3 16h3M12 16h9" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Circle cx={17} cy={8} r={2.6} stroke={color} strokeWidth={1.8} />
    <Circle cx={9} cy={16} r={2.6} stroke={color} strokeWidth={1.8} />
  </Svg>
);

/** A small price tag (a tile's "Save LKR 20" line). */
export const TagIcon = ({ size = 12, color = '#0C831F' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M2.5 4.2A1.7 1.7 0 014.2 2.5h7.1c.45 0 .88.18 1.2.5l9 9a1.7 1.7 0 010 2.4l-7.1 7.1a1.7 1.7 0 01-2.4 0l-9-9a1.7 1.7 0 01-.5-1.2z" fill={color} />
    <Circle cx={7.6} cy={7.6} r={1.9} fill="#fff" />
  </Svg>
);
