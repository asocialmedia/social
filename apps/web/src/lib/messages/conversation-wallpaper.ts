// Chat wallpapers for a DM. Client-safe (no server imports) for the same
// reason `conversation-theme.ts` is: the picker that renders the swatches, the
// thread that paints the transcript, and the API route that validates a
// submitted key all read this one table, so the swatch a member clicks and the
// wallpaper it paints cannot drift apart.
//
// A wallpaper paints the transcript BEHIND both people's bubbles. That is the
// one thing a wallpaper may do that a chat theme may not: a theme recolours the
// member's own bubbles, because painting the peer's words in the reader's
// colours would be dressing someone else's sentence. A wallpaper sits under both
// and is dimmed enough to carry neither. It is still a personal preference, so it
// lives on the member's own row and the peer never sees it.
//
// The default is NO wallpaper. A cleared key paints nothing and the transcript
// shows the app background, which is what a chat looked like before this feature
// existed and is what a member who never picked one should keep seeing. So unlike
// `conversation-theme.ts`, resolving a key here can legitimately return null
// rather than always handing back an entry.
//
// The dim is a single percentage that the picker's slider, the stored column and
// the overlay the transcript paints all read, so the value a member drags to and
// the darkness they get cannot drift.

import wallpaperDoodle from "@assets/chat-wallpapers/5.webp";
import type { StaticImageData } from "next/image";

export interface ConversationWallpaper {
  key: string;
  label: string;
  // The static import's served URL. Held as data rather than a component so the
  // thread can hand it to a CSS `background-image` and the picker can hand it to
  // a swatch, which is the same thing `next/image` would produce for a fill.
  src: string;
  // True for the member's own upload rather than a shipped preset. The picker
  // uses it to label the tile and offer a way to remove it; the thread only ever
  // needs `src`.
  isCustom?: boolean;
}

// Ordered as they appear in the picker. `servedUrl` unwraps a static import to
// its URL: Next's asset pipeline gives a `StaticImageData` object, and the
// registry stores the string both the swatch and the transcript's CSS
// `background-image` need. Unwrapping once here keeps `.src` off every call
// site, and keeps the test runner (which resolves a static import to the raw
// path string) from reaching the swatch with a malformed URL.
function servedUrl(image: StaticImageData | string): string {
  return typeof image === "string" ? image : image.src;
}

export const CONVERSATION_WALLPAPERS: readonly ConversationWallpaper[] = [
  {
    key: "doodle",
    label: "Doodle",
    src: servedUrl(wallpaperDoodle),
  },
];

// The key a member's own upload resolves under. It is deliberately NOT in
// `CONVERSATION_WALLPAPERS` and NOT accepted by `isConversationWallpaperKey`: an
// upload is identified by a media id, not by a key from this table, so letting
// "custom" be submitted as a key would store a preference no client can paint.
export const CUSTOM_WALLPAPER_KEY = "custom";

// The derivative rung a custom wallpaper is served from. The pipeline builds
// 320/640/800/1200px webp variants plus a full-resolution one; 1200 is the same
// rung a profile banner uses, and it is the right trade here because a wallpaper
// is decorative, sits behind a dimmed bubble layer, and is re-fetched each time a
// conversation is opened. A source narrower than 1200 simply has no such rung,
// and the variant route falls back to the published original.
const CUSTOM_WALLPAPER_VARIANT = "lg-webp.webp";

// The served URL for a member's own upload. The media route admits the uploader
// alone for a row with no post/comment/conversation link, which is exactly this
// case, so a personal wallpaper is never readable by the peer even if they learn
// the media id.
export function customWallpaperSrc(mediaId: string): string {
  return `/api/media/${mediaId}/v/${CUSTOM_WALLPAPER_VARIANT}`;
}

// The dim, as a percentage of black laid over the art: 0 is the art at full
// brightness, 100 is solid black. A flat black works in both themes without a
// dark branch, so the level the member picked looks the same either way.
//
// A continuous value rather than a table of named stops, for two reasons. The
// member gets the exact darkness they want instead of four guesses, and there is
// no list to keep in step with anything: the picker's value, the stored column
// and the overlay the transcript paints are all the same number, so none of them
// can disagree with the others.
export const MIN_WALLPAPER_DIM = 0;
export const MAX_WALLPAPER_DIM = 100;

// The default. Tuned against the transcript rather than picked for the art: it is
// the dim at which a received bubble still reads as a distinct surface.
export const DEFAULT_WALLPAPER_DIM = 40;

const WALLPAPERS_BY_KEY = new Map(
  CONVERSATION_WALLPAPERS.map((wallpaper) => [wallpaper.key, wallpaper])
);

// Whether a value from the network is a wallpaper this build can render. Used by
// the API route to reject unknown keys rather than storing something no client
// can paint.
export function isConversationWallpaperKey(value: unknown): value is string {
  return typeof value === "string" && WALLPAPERS_BY_KEY.has(value);
}

// Resolves the stored preference to the wallpaper it names, or null for "no
// wallpaper". Never throws, and null is a real answer rather than a failure:
//   - nothing stored is the member having cleared their choice, which is the
//     plain app background,
//   - a key from a client newer than this build must render as the plain
//     background rather than as the wrong art, and
//   - a media id whose row has been deleted degrades the same way.
//
// The upload wins over the preset when both are somehow set. That should be
// impossible (every writer clears the other in the same UPDATE), but if a future
// bug breaks the invariant the member sees the wallpaper they just uploaded,
// which is a far better failure than a blank chat.
export function resolveConversationWallpaper(
  key: string | null | undefined,
  mediaId: string | null | undefined
): ConversationWallpaper | null {
  if (mediaId) {
    return {
      isCustom: true,
      key: CUSTOM_WALLPAPER_KEY,
      label: "Custom",
      src: customWallpaperSrc(mediaId),
    };
  }
  if (!key) {
    return null;
  }
  return WALLPAPERS_BY_KEY.get(key) ?? null;
}

// Whether a dim value from the network is one this build can store and render.
// The API route rejects anything else rather than writing a value the picker
// cannot show: out of range, fractional, or not a number.
export function isWallpaperDim(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_WALLPAPER_DIM &&
    value <= MAX_WALLPAPER_DIM
  );
}

// Resolves a stored dim to a percentage the picker can show and the transcript
// can paint. A cleared value falls back to the default, because a wallpaper the
// member cannot read is a worse outcome than one at a dim they did not pick. A
// value that is merely out of range is clamped rather than discarded, so a row
// written by a build with a wider range still paints instead of jumping to the
// default.
export function resolveWallpaperDim(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(
      MAX_WALLPAPER_DIM,
      Math.max(MIN_WALLPAPER_DIM, Math.round(value))
    );
  }
  return DEFAULT_WALLPAPER_DIM;
}

// The overlay the transcript paints for a dim, or null when there is nothing to
// paint. Null at 0 rather than a transparent black: an undimmed chat should not
// carry a full-transcript compositing layer for no visible change.
export function wallpaperDimOverlay(
  value: number | null | undefined
): string | null {
  const dim = resolveWallpaperDim(value);
  if (dim === MIN_WALLPAPER_DIM) {
    return null;
  }
  return `rgba(0, 0, 0, ${dim / 100})`;
}
