// WHERE the conversation's details surface lives, as a function of the viewport, what
// the user asked for, and whether they folded the desktop pane away.
//
// This is deliberately not a CSS question. The details surface is expensive -- it
// reads the refs index, keeps three paged lists, and asks the decryptor for the
// loaded window -- so a hidden-but-mounted copy is not free: two mounted copies would
// double every read, run two independent cursors over the same store, and leave the
// walk's consumer count wrong. Mounting is therefore decided in JS, and this is the
// whole of that decision.
//
// It is one function because the inputs interact, and getting the interaction wrong
// is silent: the rail is shown by default on desktop, so a stale `requested` from a
// sheet opened on a phone would otherwise mount a dialog on top of a pane that is
// already showing the same thing.

export type DetailsPlacement = "none" | "rail" | "sheet";

export interface DetailsPlacementInput {
  // Whether the desktop pane is folded away. Folded means GONE, not narrow: the body
  // is the expensive part, and a visible sliver of pane is still a mount that keeps
  // reading. It resolves to `none`, so the caller that asks "is anything showing"
  // gets a straight answer and the walk's consumer count cannot drift from what is
  // on screen.
  collapsed: boolean;
  // True at Tailwind's `lg` and up. Matched with `64rem` in the media query for the
  // same reason the class is `lg`: the CSS and the JS have to agree on one number,
  // and `rem` is the unit the class is defined in.
  desktopViewport: boolean;
  // Whether the details were explicitly asked for, which is what the thread's header
  // button sets. Always false on desktop, where the surface is pinned.
  requested: boolean;
}

export function detailsPlacement({
  collapsed,
  desktopViewport,
  requested,
}: DetailsPlacementInput): DetailsPlacement {
  // The rail wins unconditionally, including when `requested` is true: that state is
  // reachable by opening the sheet on a phone and then widening the window, and the
  // pinned pane is already the same content. Two surfaces would be one too many, and
  // the sheet's would be the one the user cannot reach.
  if (desktopViewport) {
    return collapsed ? "none" : "rail";
  }
  return requested ? "sheet" : "none";
}
