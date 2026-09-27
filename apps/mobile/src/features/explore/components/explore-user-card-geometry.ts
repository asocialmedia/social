// Geometry for the Explore user card's avatar ring.
//
// This is a port of web's `rounded-2xl ring-4` on a size-56 `UserAvatar`
// (apps/web/src/components/discover/explore-user-card.tsx). The values below
// are all states web states as an outright literal, so they are pinned here
// rather than derived, and explore-user-card-geometry.test.ts asserts them so a
// tweak on one side cannot silently drift from the other.
//
// Kept free of react-native imports so the test can load it directly.

// Web passes `size={56}`.
export const AVATAR_SIZE = 56;

// Web's `rounded-2xl` is 1rem. Note this is deliberately *not* the mobile
// UserAvatar's own default of `size * 0.3` (which rounds to 17): web states 16,
// so 16 is what we ask for, and the two stay in step.
export const AVATAR_CORNER = 16;

// Web's `ring-4`.
export const RING_BORDER = 4;

// A border of width B drawn *inside* a box with corner radius R paints its
// inner edge at radius R - B, so the box has to be rounded by R - B for the
// image to nest inside the ring. Anything tighter draws the ring's inner edge
// inside the image's own curve, and the corners poke through and get clipped.
export const RING_RADIUS = AVATAR_CORNER + RING_BORDER;

// Web's `-mt-9`, which lifts the ring+image up so it straddles the banner.
export const AVATAR_OVERLAP = -36;

// The card body is a column flex container, and React Native stretches children
// across the cross axis by default. Left unguarded that turns the ring into a
// border painted around a full-width bar instead of a square around the avatar.
// Web gets the same guarantee from `shrink-0` on the avatar link; this is the
// equivalent, and it is pinned by a test because it is invisible until a
// highlighted card renders the ring at high contrast against the card.
export const AVATAR_RING_ALIGN_SELF = "flex-start";
