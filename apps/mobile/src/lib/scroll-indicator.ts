import { Platform } from "react-native";
import type { PlatformOSType } from "react-native";

// Whether scroll views draw their scroll indicator, decided per platform.
//
// Native: hidden. A touch scroll view is self-evident - you drag it - and the
// indicator is a bar drawn over the content on every screen, which reads as
// noise rather than as information.
//
// Web: kept. A pointer user has no drag affordance and no other signal that a
// region scrolls at all; without the scrollbar a long feed or comment thread
// reads as a finished, complete page.
//
// This has to be a value passed at the call site rather than a hardcoded
// false, because react-native-web derives its scrollbar from the very same
// prop: ScrollViewBase computes hideScrollbar when either indicator is false
// and emits scrollbarWidth: "none". Hardcoding false therefore hides the
// scrollbar on web too, which is the opposite of what web wants.

/**
 * Whether a platform draws the scroll indicator.
 *
 * Split out from the constant so the rule is testable for every platform
 * without having to stand up a web bundle, while call sites keep reading a
 * plain value.
 */
export function shouldShowScrollIndicator(platform: PlatformOSType): boolean {
  return platform === "web";
}

/** True only where the scroll indicator should be drawn, i.e. the web build. */
export const SHOWS_SCROLL_INDICATOR = shouldShowScrollIndicator(Platform.OS);
