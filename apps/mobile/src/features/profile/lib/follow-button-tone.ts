// The follow-button tone decision web makes in two places: Follow wears the
// orange `.btn-3d` (`premium` variant) and Following wears the neutral
// `.btn-3d-gray` (`premium-neutral` variant). See
// apps/web/src/components/layouts/user/client/client-follow-button.tsx and
// apps/web/src/components/protocols/external-follow-button.tsx. Every native
// follow surface must resolve through this helper so the tones cannot drift.
import {
  btnGray,
  followButtonShadows,
  ORANGE_GRADIENT,
} from "@/components/surface/recipes";

export interface FollowButtonTone {
  colors: readonly [string, string];
  shadows: string;
  textColor: string;
}

export function followButtonTone(
  isDark: boolean,
  following: boolean
): FollowButtonTone {
  if (following) {
    const gray = btnGray(isDark);
    return {
      colors: gray.resting.colors,
      shadows: gray.resting.shadows,
      textColor: gray.resting.text,
    };
  }
  return {
    colors: ORANGE_GRADIENT,
    shadows: followButtonShadows(isDark),
    textColor: "#ffffff",
  };
}
