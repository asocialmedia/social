// Shared physical tuning keeps web and native arrivals in the same motion family.
export const BUBBLE_MOTION = {
  incoming: {
    damping: 32,
    duration: 460,
    mass: 1,
    scaleX: 0.93,
    scaleY: 0.86,
    stiffness: 440,
    x: -10,
    y: 22,
  },
  outgoing: {
    damping: 27,
    duration: 560,
    mass: 1,
    scaleX: 0.84,
    scaleY: 0.72,
    stiffness: 400,
    x: 12,
    y: 48,
  },
} as const;

export type BubbleMotionDirection = keyof typeof BUBBLE_MOTION;

// Sample the damped spring once, never on an animation frame. CSS interpolates
// the resulting curve on the compositor; native runs the same spring on its UI thread.
export function bubbleSpringProgress(
  direction: BubbleMotionDirection,
  milliseconds: number
): number {
  const { stiffness, damping, mass } = BUBBLE_MOTION[direction];
  const frequency = Math.sqrt(stiffness / mass);
  const decay = damping / (2 * mass);
  const dampedFrequency = Math.sqrt(frequency ** 2 - decay ** 2);
  const seconds = Math.max(0, milliseconds) / 1000;
  return (
    1 -
    Math.exp(-decay * seconds) *
      (Math.cos(dampedFrequency * seconds) +
        (decay / dampedFrequency) * Math.sin(dampedFrequency * seconds))
  );
}

function springEasing(direction: BubbleMotionDirection): string {
  const { duration } = BUBBLE_MOTION[direction];
  const samples = Array.from({ length: 41 }, (_, index) =>
    index === 40
      ? 1
      : Number(
          bubbleSpringProgress(direction, (index / 40) * duration).toFixed(4)
        )
  );
  return `linear(${samples.join(", ")})`;
}

export const BUBBLE_SPRING_EASING = {
  incoming: springEasing("incoming"),
  outgoing: springEasing("outgoing"),
};

export interface BubbleLaunchOrigin {
  x: number;
  y: number;
}

export function bubbleLaunchOffset(
  origin: BubbleLaunchOrigin | undefined,
  destination: { right: number; bottom: number }
): BubbleLaunchOrigin {
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    return { x: BUBBLE_MOTION.outgoing.x, y: BUBBLE_MOTION.outgoing.y };
  }
  return {
    x: Math.max(-24, Math.min(24, origin.x - destination.right)),
    y: Math.max(24, Math.min(72, origin.y - destination.bottom)),
  };
}
