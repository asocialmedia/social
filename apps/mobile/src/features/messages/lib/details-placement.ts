// WHERE the conversation's details surface lives.
// Ported from apps/web/src/components/messages/details-placement.ts.
//
// This is deliberately not a styling question. The details surface is
// expensive -- it reads the shared refs and asks the decryptor for the loaded
// window -- so a hidden-but-mounted copy is not free: two mounted copies would
// double every read and run two independent cursors over one store. Mounting is
// therefore decided in JS, and this is the whole of that decision.
//
// It is one function because the inputs interact, and getting the interaction
// wrong is silent: the rail is shown by default on desktop, so a stale
// `requested` from a sheet opened on a phone would otherwise mount a dialog on
// top of a pane that is already showing the same thing.
//
// Native has no desktop rail (a bottom sheet is the only surface), so the
// desktop branch is unreachable here -- but the rule is ported 1:1 so the two
// clients cannot drift when the thread header asks "is anything showing".

export type DetailsPlacement = "none" | "rail" | "sheet";

export interface DetailsPlacementInput {
  // Whether the desktop pane is folded away. Folded means GONE, not narrow.
  collapsed: boolean;
  // True at Tailwind's `lg` and up on web. Always false on native.
  desktopViewport: boolean;
  // Whether the details were explicitly asked for, which is what the thread's
  // header button sets.
  requested: boolean;
}

export function detailsPlacement({
  collapsed,
  desktopViewport,
  requested,
}: DetailsPlacementInput): DetailsPlacement {
  // The rail wins unconditionally, including when `requested` is true: that
  // state is reachable by opening the sheet on a phone and then widening the
  // window, and the pinned pane is already the same content.
  if (desktopViewport) {
    return collapsed ? "none" : "rail";
  }
  return requested ? "sheet" : "none";
}

// Whether the thread header offers the pane's fold control.
//
// A question about the VIEWPORT, and deliberately not derived from the
// placement -- folding resolves the placement to `none`, so a control gated on
// "the pane is showing" would unmount at the exact moment it is used. Always
// false on native: a phone has no pane to fold, and the sheet carries its own
// dismissal.
export function showsDetailsRailToggle(desktopViewport: boolean): boolean {
  return desktopViewport;
}
