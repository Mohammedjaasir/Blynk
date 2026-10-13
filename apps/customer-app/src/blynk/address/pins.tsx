import Svg, { Circle, Path } from 'react-native-svg';
import { C } from '@/lib/theme';

/** Video pin: 31 pt yellow head (ink outline, so it reads on the pale map) with an ink hole, a short point, then a yellow tail dot. */
export function Pin() {
  return (
    <Svg width={32} height={46} viewBox="0 0 32 46">
      <Path d="M16 1a15 15 0 0115 15c0 7.5-5.4 13.3-12 14.7L16 35l-3-4.3C6.4 29.3 1 23.5 1 16A15 15 0 0116 1z" fill={C.brand} stroke={C.brandInk} strokeWidth={1.6} strokeLinejoin="round" />
      <Circle cx={16} cy={16} r={5.2} fill={C.brandInk} />
      <Circle cx={16} cy={39.5} r={4.5} fill={C.brand} stroke={C.brandInk} strokeWidth={1.6} />
    </Svg>
  );
}
/** Pin height and where its tail dot (the spot on the ground) sits inside it. */
export const PIN_H = 46;
export const PIN_GROUND_Y = 39.5;

export const SmallPin = () => (
  <Svg width={13} height={17} viewBox="0 0 13 17">
    <Path d="M6.5 0A6.5 6.5 0 0113 6.5c0 3.2-2.3 5.8-5.2 6.4L6.5 15l-1.3-2.1C2.3 12.3 0 9.7 0 6.5A6.5 6.5 0 016.5 0z" fill={C.brand} stroke={C.brandInk} strokeWidth={1} />
    <Circle cx={6.5} cy={6.5} r={2.3} fill={C.brandInk} />
  </Svg>
);

export const TargetIcon = () => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Circle cx={12} cy={12} r={6.5} stroke={C.brandInk} strokeWidth={2.2} />
    <Circle cx={12} cy={12} r={2.6} fill={C.brandInk} />
    <Path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke={C.brandInk} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
