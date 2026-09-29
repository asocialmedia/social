// The structured "shared" content of a message: the posts it points at, the media
// it carries, and the links it pasted. ONE extractor, used by three callers:
//
//   - the live per-transcript indexes behind the details panel,
//   - the local index writer, which persists what this returns,
//   - nothing else.
//
// That is deliberate. The earlier arrangement derived the panel's lists one way
// and would have derived the persisted rows another, which is exactly the drift
// that already bit the search index: the store stored captions while the
// transcript matched kind labels, so a captionless image was findable in the
// thread and invisible after a reload. One function cannot disagree with itself.
//
// Payloads are the FULL `MessagePayload` here, not the loose structural view the
// search index accepts. This is the only place that reads the attachment and
// post references, and it is also the only place that can turn them into rows.

import { extractPostUrls } from "@/lib/link-embeds/shared";
import { getMediaImages } from "@/lib/messages/crypto";
import type { MessagePayload } from "@/lib/messages/crypto";

// What one message contributes, grouped by the tab it belongs to.
//
// `media` keeps the image's position WITHIN its message, because that is the
// stable identity the fullscreen viewer anchors on (`messageId:imageIndex`) and
// because it survives an older page prepending without renumbering.
export interface SharedMediaRef {
  height?: number;
  imageIndex: number;
  kind: "gif" | "image";
  url: string;
  width?: number;
}

export interface SharedRefs {
  links: string[];
  media: SharedMediaRef[];
  // Post ids, in the order they appear: an explicit share first, then any in-app
  // post link found in the text.
  postIds: string[];
}

// Refs for a payload, or null when the payload carries none.
//
// Null rather than an empty record so the writer can distinguish "nothing to
// store" from "not decrypted yet", which is what keeps a pending row out of the
// index instead of storing a row that claims the message has no media.
//
// The in-app/external split is NOT made here. It needs the site origin, which
// differs between a dev origin and production, and baking it into stored rows
// would make rows written on one origin wrong on another. Classification happens
// at read time (see classifySharedRef) so a row is just a URL.
export function extractSharedRefs(payload: MessagePayload): SharedRefs | null {
  const media: SharedMediaRef[] = [];
  const postIds: string[] = [];
  let links: string[] = [];

  if (payload.type === "post") {
    // Truthy-checked rather than assumed. A payload that decrypts to a shape this
    // build does not recognise is not hypothetical here: the writer's own test
    // fixtures are built from a deliberately loose view, and a missing `postId`
    // would otherwise be stored as a post share that resolves to nothing.
    if (payload.postId) {
      postIds.push(payload.postId);
    }
  } else if (payload.type === "media") {
    const images = getMediaImages(payload);
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      if (!image?.url) {
        continue;
      }
      media.push({
        height: image.height,
        imageIndex,
        kind: payload.kind,
        url: image.url,
        width: image.width,
      });
    }
  }

  // A text body, or the caption typed alongside a post share or a media album.
  // Both are places a link can hide, and the transcript unfurls both, so the
  // index records both. String-checked, because a payload of a shape this build
  // does not recognise can reach here and `extractPostUrls` would throw on a
  // non-string instead of contributing nothing.
  const text = typeof payload.content === "string" ? payload.content : "";
  if (text) {
    // Sanitized, deduped and capped per message, exactly as the bubble unfurls
    // them, so the list and the thread can never disagree about what a message
    // contains.
    links = extractPostUrls(text);
  }

  if (media.length === 0 && postIds.length === 0 && links.length === 0) {
    return null;
  }
  return { links, media, postIds };
}

// Whether a message's refs changed, ignoring anything that cannot affect a
// rendered row. Used to decide whether a re-index is needed for a payload whose
// TEXT the search signature would treat as unchanged — an edit that swaps one
// link for another changes no tokens but does change a row.
export function sharedRefsEqual(
  a: SharedRefs | null,
  b: SharedRefs | null
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (
    a.links.length !== b.links.length ||
    a.postIds.length !== b.postIds.length ||
    a.media.length !== b.media.length
  ) {
    return false;
  }
  for (let index = 0; index < a.links.length; index += 1) {
    if (a.links[index] !== b.links[index]) {
      return false;
    }
  }
  for (let index = 0; index < a.postIds.length; index += 1) {
    if (a.postIds[index] !== b.postIds[index]) {
      return false;
    }
  }
  for (let index = 0; index < a.media.length; index += 1) {
    const left = a.media[index];
    const right = b.media[index];
    if (
      left === undefined ||
      right === undefined ||
      left.url !== right.url ||
      left.kind !== right.kind ||
      left.imageIndex !== right.imageIndex
    ) {
      return false;
    }
  }
  return true;
}
