import type { ReactElement, ReactNode } from "react";
import Svg, { Circle, G, Line, Path } from "react-native-svg";

import type { ToastState } from "./types";

// Port of gooey-toast@0.2.2 `dist/icons.js`. Upstream builds each icon on a
// 24x24 viewBox with `fill: none`, `stroke: currentColor`, `stroke-width: 2`
// and round caps/joins, then sizes the `<svg>` to 16x16. Those attributes are
// reproduced exactly so the glyphs match the web toasts; `currentColor` becomes
// the `color` prop, which is how the badge tints the icon with its state tone.
export interface StateIconProps {
  color?: string;
  size?: number;
}

const ICON_VIEWBOX = 24;

const DEFAULT_ICON_COLOR = "#ffffff";

const GLYPH_PROPS = {
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
} as const;

function Glyph({
  children,
  color,
  size,
}: StateIconProps & { children: ReactNode }) {
  return (
    <Svg
      height={size}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width={size}
    >
      <G {...GLYPH_PROPS} stroke={color ?? DEFAULT_ICON_COLOR}>
        {children}
      </G>
    </Svg>
  );
}

export const SuccessIcon = (props: StateIconProps) => (
  <Glyph {...props}>
    <Path d="M20 6 9 17l-5-5" />
  </Glyph>
);

export const ErrorIcon = (props: StateIconProps) => (
  <Glyph {...props}>
    <Path d="M18 6 6 18" />
    <Path d="m6 6 12 12" />
  </Glyph>
);

export const WarningIcon = (props: StateIconProps) => (
  <Glyph {...props}>
    <Circle cx={12} cy={12} r={10} />
    <Line x1={12} x2={12} y1={8} y2={12} />
    <Line x1={12} x2={12.01} y1={16} y2={16} />
  </Glyph>
);

export const InfoIcon = (props: StateIconProps) => (
  <Glyph {...props}>
    <Circle cx={12} cy={12} r={10} />
    <Path d="m4.93 4.93 4.24 4.24" />
    <Path d="m14.83 9.17 4.24-4.24" />
    <Path d="m14.83 14.83 4.24 4.24" />
    <Path d="m9.17 14.83-4.24 4.24" />
    <Circle cx={12} cy={12} r={4} />
  </Glyph>
);

export const ActionIcon = (props: StateIconProps) => (
  <Glyph {...props}>
    <Path d="M5 12h14" />
    <Path d="m12 5 7 7-7 7" />
  </Glyph>
);

// Upstream tags the loader `data-gooey-icon="spin"` and rotates it in CSS. The
// caller wraps this in a Reanimated rotation, since an SVG path cannot carry
// its own animation.
export const SpinnerIcon = (props: StateIconProps) => (
  <Glyph {...props}>
    <Path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Glyph>
);

export const STATE_ICONS: Record<
  ToastState,
  (props: StateIconProps) => ReactElement
> = {
  action: ActionIcon,
  error: ErrorIcon,
  info: InfoIcon,
  loading: SpinnerIcon,
  success: SuccessIcon,
  warning: WarningIcon,
};
