import { AnimatableValue, AnimationCallback, withSpring as rnWithSpring } from 'react-native-reanimated';

type SpringCfg = NonNullable<Parameters<typeof rnWithSpring>[1]>;

/**
 * Reanimated 4's withSpring defaults to mass 4 and an energy threshold of 6e-9, so a
 * spring tuned with damping/stiffness alone keeps creeping toward its target for ~7s,
 * repainting its view every frame. With dozens of cards that is constant jank.
 * Every spring in the app goes through here: mass 1 and a perceptual rest threshold,
 * so springs feel snappy and actually stop.
 */
export function withSpring<T extends AnimatableValue>(to: T, config?: SpringCfg, callback?: AnimationCallback): T {
  'worklet';
  return rnWithSpring(to, { mass: 1, energyThreshold: 1e-4, ...config }, callback);
}
