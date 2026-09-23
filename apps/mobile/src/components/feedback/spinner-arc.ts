// Conic-gradient arc geometry for Spinner3D. Web's arc is
// conic-gradient(from 0deg, transparent 0deg, transparent 72deg, #ff9500
// 140deg, #e65500 300deg, transparent 360deg) masked into a ring. SVG has no
// conic gradient, so the ring is cut into thin annular slices and each slice
// takes the gradient's color at its mid angle. Pure so it is unit-testable.

export interface ArcSlice {
  color: string;
  key: string;
  opacity: number;
  path: string;
}

interface ConicStop {
  angle: number;
  opacity: number;
  rgb: readonly [number, number, number];
}

const ORANGE = [0xff, 0x95, 0x00] as const;
const DEEP_ORANGE = [0xe6, 0x55, 0x00] as const;

// `transparent` next to a color interpolates in premultiplied space, so the
// fade keeps the neighbor's hue and only the alpha ramps.
export const CONIC_STOPS: readonly ConicStop[] = [
  { angle: 72, opacity: 0, rgb: ORANGE },
  { angle: 140, opacity: 1, rgb: ORANGE },
  { angle: 300, opacity: 1, rgb: DEEP_ORANGE },
  { angle: 360, opacity: 0, rgb: DEEP_ORANGE },
];

function toHex(channel: number): string {
  return Math.round(channel).toString(16).padStart(2, "0");
}

// Color and opacity of the conic gradient at an angle (degrees clockwise
// from 12 o'clock). Transparent before the first stop.
export function conicColorAt(angle: number): {
  color: string;
  opacity: number;
} {
  const [first] = CONIC_STOPS;
  if (!first || angle <= first.angle) {
    return { color: "#ff9500", opacity: 0 };
  }
  for (let index = 1; index < CONIC_STOPS.length; index += 1) {
    const from = CONIC_STOPS[index - 1];
    const to = CONIC_STOPS[index];
    if (from && to && angle <= to.angle) {
      const t = (angle - from.angle) / (to.angle - from.angle);
      const rgb = from.rgb.map(
        (channel, channelIndex) =>
          channel + ((to.rgb[channelIndex] ?? channel) - channel) * t
      );
      return {
        color: `#${rgb.map(toHex).join("")}`,
        opacity: from.opacity + (to.opacity - from.opacity) * t,
      };
    }
  }
  return { color: "#e65500", opacity: 0 };
}

function polar(center: number, radius: number, angle: number): string {
  const radians = ((angle - 90) * Math.PI) / 180;
  const x = center + radius * Math.cos(radians);
  const y = center + radius * Math.sin(radians);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

// Annular sector between two angles (degrees clockwise from 12 o'clock).
export function annularSlicePath(options: {
  center: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
}): string {
  const { center, endAngle, innerRadius, outerRadius, startAngle } = options;
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${polar(center, outerRadius, startAngle)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${polar(center, outerRadius, endAngle)}`,
    `L ${polar(center, innerRadius, endAngle)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${polar(center, innerRadius, startAngle)}`,
    "Z",
  ].join(" ");
}

// Slices from the first visible stop to 360deg. Fully opaque slices overlap
// their neighbor slightly so anti-aliasing never draws seams across the
// solid run; translucent ones abut exactly so the fades do not band.
export function buildConicArc(options: {
  center: number;
  innerRadius: number;
  outerRadius: number;
  sliceDegrees?: number;
}): ArcSlice[] {
  const { center, innerRadius, outerRadius, sliceDegrees = 3 } = options;
  const start = CONIC_STOPS[0]?.angle ?? 0;
  const slices: ArcSlice[] = [];
  for (let angle = start; angle < 360; angle += sliceDegrees) {
    const end = Math.min(360, angle + sliceDegrees);
    const { color, opacity } = conicColorAt((angle + end) / 2);
    if (opacity <= 0.001) {
      continue;
    }
    const overlap = opacity >= 0.999 && end < 360 ? 0.6 : 0;
    slices.push({
      color,
      key: `${angle}`,
      opacity: Number(opacity.toFixed(3)),
      path: annularSlicePath({
        center,
        endAngle: end + overlap,
        innerRadius,
        outerRadius,
        startAngle: angle,
      }),
    });
  }
  return slices;
}
