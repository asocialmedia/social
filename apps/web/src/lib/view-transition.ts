"use client";

// Small wrapper around the native View Transitions API so feed -> post ->
// media feels like a single connected motion instead of three hard page
// swaps. Falls back to a plain navigation in browsers without support or when
// the user prefers reduced motion, so it degrades gracefully everywhere.

type TransitionCallback = () => void;

interface ViewTransitionLike {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
}

function canViewTransition(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  if (!("startViewTransition" in document)) {
    return false;
  }
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return false;
  }
  return true;
}

// Wraps a state/route update in a view transition. The update callback runs
// inside the transition so the browser snapshots the outgoing frame, applies
// the update, then crossfades to the incoming frame.
export function withViewTransition(update: TransitionCallback): void {
  if (!canViewTransition()) {
    update();
    return;
  }
  const documentWithTransition = document as Document & {
    startViewTransition: (callback: TransitionCallback) => ViewTransitionLike;
  };
  try {
    const transition = documentWithTransition.startViewTransition(update);
    // If the update throws or never settles, fall back to finishing the nav
    // so the page never gets stuck half-frozen.
    void (async () => {
      try {
        await transition.updateCallbackDone;
      } catch {
        transition.skipTransition();
      }
    })();
  } catch {
    update();
  }
}

// Convenience for route navigation: pushes to `href` wrapped in a view
// transition. Pass a `router.push`-style callback.
export function transitionNavigate(
  navigate: () => void,
  fallback: () => void = navigate
): void {
  withViewTransition(() => {
    try {
      navigate();
    } catch {
      fallback();
    }
  });
}
