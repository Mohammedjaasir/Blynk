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

export const MenuIcon = ({ size = 22, color = '#fff' }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M4 6h16M4 12h16M9 18h11" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
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

export const VegMark = ({ color = '#0B9A2C', size = 11 }: { color?: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Rect x={0.75} y={0.75} width={10.5} height={10.5} rx={2} fill="none" stroke={color} strokeWidth={1.3} />
    <Circle cx={6} cy={6} r={2.8} fill={color} />
  </Svg>
);

export const PinIcon = ({ size = 34, color = '#0B9A2C' }: P) => (
  <Svg width={size} height={size * 1.25} viewBox="0 0 32 40">
    <Path d="M16 39c0 0 13-14.5 13-24A13 13 0 003 15c0 9.5 13 24 13 24z" fill={color} />
    <Circle cx={16} cy={15} r={5.5} fill="#fff" />
  </Svg>
);
