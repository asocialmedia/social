import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

export interface MediaImageRef {
  height?: number;
  url: string;
  width?: number;
}

export interface StickerPresentation {
  animated: boolean;
  mediaId: string;
  version: 1;
}

export type StickerMessagePayload = Extract<
  MessagePayload,
  {
    type: "media";
    kind: "gif" | "image";
    presentation?: "sticker";
    sticker?: StickerPresentation;
    url: string;
  }
> & { presentation: "sticker"; sticker: StickerPresentation };

// The kinds an attachment in a version-2 media payload can carry. `view-once`
// is the protected kind: it travels as an opaque reference and never as a
// fetchable URL, so a forged or replayed payload cannot downgrade its delivery
// policy and an older reader cannot fetch the bytes.
export type MediaAttachmentKind =
  | "gif"
  | "image"
  | "video"
  | "file"
  | "view-once";

export interface MediaImageAttachment {
  height?: number;
  kind: "gif" | "image";
  url: string;
  width?: number;
}

export interface MediaVideoAttachment {
  durationSec?: number;
  height?: number;
  kind: "video";
  posterUrl?: string;
  url: string;
  width?: number;
}

export interface MediaFileAttachment {
  bytes?: number;
  filename: string;
  kind: "file";
  mimeType?: string;
  url: string;
}

export interface ViewOnceAttachment {
  height?: number;
  kind: "view-once";
  ref: string;
  width?: number;
}

export type MediaAttachmentRef =
  | MediaImageAttachment
  | MediaVideoAttachment
  | MediaFileAttachment
  | ViewOnceAttachment;

export type MessagePayload =
  | {
      type: "text";
      content: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      type: "post";
      content?: string;
      postId: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      // New senders keep an album in one transcript row.
      type: "media";
      kind: "gif" | "image";
      images: MediaImageRef[];
      content?: string;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      // Older clients still send a single image, and their history must remain readable.
      type: "media";
      kind: "gif" | "image";
      presentation?: "sticker";
      sticker?: StickerPresentation;
      url: string;
      content?: string;
      width?: number;
      height?: number;
      replyToId?: string;
      replyToSenderId?: string;
    }
  | {
      // Version 2 attachments: per-item kinds (photos, GIFs, videos, files)
      // plus opaque view-once references. Both v1 shapes above stay decodable
      // forever; readers discriminate on key presence, never on a version field.
      type: "media";
      attachments: MediaAttachmentRef[];
      content?: string;
      replyToId?: string;
      replyToSenderId?: string;
    };

// The URL policy threaded through payload validation. Web derives the default
// from process.env.NODE_ENV; native injects an explicit value because a device
// has no process.env, and the Android emulator alias is native-only.
export interface MediaUrlPolicy {
  // True when plain-http loopback URLs are acceptable (local development only).
  allowLoopbackHttp?: boolean;
  // The Android emulator's alias for the host machine (10.0.2.2). Only
  // meaningful together with allowLoopbackHttp, and web never sets it.
  allowEmulatorHost?: boolean;
}

export function parseMessagePayload(
  plaintext: string,
  policy: MediaUrlPolicy = {}
): MessagePayload {
  // The decrypted JSON remains peer-controlled and is validated at this boundary.
  const payload = JSON.parse(plaintext) as Partial<MessagePayload>;
  if (
    payload.type !== "text" &&
    payload.type !== "post" &&
    payload.type !== "media"
  ) {
    throw new Error("Invalid message payload");
  }
  if (payload.type === "text" && typeof payload.content !== "string") {
    throw new Error("Invalid text payload");
  }
  if (payload.type === "post" && typeof payload.postId !== "string") {
    throw new Error("Invalid post payload");
  }
  if (payload.type === "media") {
    if (!isValidMediaPayload(payload, policy)) {
      throw new Error("Invalid media payload");
    }
    if (payload.content !== undefined && typeof payload.content !== "string") {
      throw new Error("Invalid media caption");
    }
    // Typed text never rides along with a view-once photo: it is sent as an
    // ordinary text message instead of silently becoming a protected caption.
    if (payload.content !== undefined && hasViewOnceAttachment(payload)) {
      throw new Error("Invalid media caption");
    }
  }
  return payload as MessagePayload;
}

// Match proxy paths without passing protocol-relative or traversal input to URL parsing.
const RELATIVE_MEDIA_PATH_RE =
  /^\/api\/media\/[A-Za-z0-9_-]+(?:\/v\/[A-Za-z0-9.-]+)?(?:\?[A-Za-z0-9_=&%.-]+)?$/;

// An opaque attachment reference: a stable media identifier with no scheme and
// no path, so it can never be fetched directly by a client.
const ATTACHMENT_REF_RE = /^[A-Za-z0-9_-]{1,128}$/;

// A bounded filename, kept clear of path separators and control characters so
// it can render safely in a card and in an export. Matching control characters
// here is the point: their presence is what disqualifies the name.
// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const FILENAME_RE = /^[^\u0000-\u001F/\\]{1,255}$/;

const MIME_TYPE_RE =
  /^[A-Za-z0-9!#$&^_.+-]{1,127}\/[A-Za-z0-9!#$&^_.+-]{1,127}$/;

const MAX_MEDIA_DIMENSION = 16_384;
const MAX_MEDIA_FILE_BYTES = 256 * 1024 * 1024;
const MAX_MEDIA_DURATION_SEC = 60 * 60;

interface RawMediaPayload {
  attachments?: unknown;
  bytes?: unknown;
  content?: unknown;
  durationSec?: unknown;
  filename?: unknown;
  height?: unknown;
  images?: unknown;
  kind?: unknown;
  mimeType?: unknown;
  posterUrl?: unknown;
  presentation?: unknown;
  ref?: unknown;
  sticker?: unknown;
  url?: unknown;
  width?: unknown;
}

function hasViewOnceAttachment(
  payload: Partial<Extract<MessagePayload, { type: "media" }>>
): boolean {
  const raw = payload as RawMediaPayload;
  if (!Array.isArray(raw.attachments)) {
    return false;
  }
  return raw.attachments.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as RawMediaPayload).kind === "view-once"
  );
}

function isValidMediaPayload(
  payload: Partial<Extract<MessagePayload, { type: "media" }>>,
  policy: MediaUrlPolicy
): boolean {
  const raw = payload as RawMediaPayload;
  if (raw.presentation !== undefined || raw.sticker !== undefined) {
    return isValidStickerMediaPayload(raw, policy);
  }
  // Key presence distinguishes the three generations: v2 attachments, a
  // grouped v1 album, and a legacy single-image row.
  if ("attachments" in raw) {
    return isValidMediaAttachmentList(raw.attachments, policy);
  }
  if (raw.kind !== "gif" && raw.kind !== "image") {
    return false;
  }
  if ("images" in raw) {
    return isValidMediaImageList(raw.images, policy);
  }
  return isValidMediaImage(raw, policy);
}

export function isStickerMessagePayload(
  payload: MessagePayload
): payload is StickerMessagePayload {
  return (
    payload.type === "media" &&
    "presentation" in payload &&
    payload.presentation === "sticker" &&
    "sticker" in payload &&
    payload.sticker !== undefined
  );
}

function isValidStickerMediaPayload(
  raw: RawMediaPayload,
  policy: MediaUrlPolicy
): boolean {
  if (
    raw.presentation !== "sticker" ||
    typeof raw.sticker !== "object" ||
    raw.sticker === null ||
    (raw.kind !== "image" && raw.kind !== "gif") ||
    typeof raw.url !== "string" ||
    !raw.url.startsWith("/api/media/") ||
    raw.url.startsWith("//") ||
    !isAllowedMediaUrl(raw.url, policy) ||
    "images" in raw ||
    "attachments" in raw ||
    raw.content !== undefined
  ) {
    return false;
  }
  const sticker = raw.sticker as Record<string, unknown>;
  if (
    sticker.version !== 1 ||
    typeof sticker.mediaId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(sticker.mediaId) ||
    typeof sticker.animated !== "boolean" ||
    sticker.animated !== (raw.kind === "gif") ||
    (raw.kind === "image" && sticker.animated)
  ) {
    return false;
  }
  const path = raw.url.startsWith("/")
    ? raw.url.split(/[?#]/u, 1)[0]
    : (() => {
        try {
          const parsed = new URL(raw.url);
          return parsed.pathname;
        } catch {
          return "";
        }
      })();
  const mediaIdFromPath =
    /^\/api\/media\/(?<mediaId>[A-Za-z0-9_-]{1,128})(?:\/v\/sticker-full\.webp)?$/u.exec(
      path
    )?.groups?.mediaId;
  if (mediaIdFromPath !== sticker.mediaId) {
    return false;
  }
  return (
    (raw.width === undefined ||
      (typeof raw.width === "number" && raw.width > 0 && raw.width <= 512)) &&
    (raw.height === undefined ||
      (typeof raw.height === "number" && raw.height > 0 && raw.height <= 512))
  );
}

function isValidMediaAttachmentList(
  attachments: unknown,
  policy: MediaUrlPolicy
): boolean {
  if (
    !Array.isArray(attachments) ||
    attachments.length === 0 ||
    attachments.length > MAX_MESSAGE_ATTACHMENTS
  ) {
    return false;
  }
  const valid = attachments.every((attachment) => {
    if (typeof attachment !== "object" || attachment === null) {
      return false;
    }
    return isValidMediaAttachment(attachment as RawMediaPayload, policy);
  });
  if (!valid) {
    return false;
  }
  const viewOnceCount = attachments.filter(
    (attachment) => (attachment as RawMediaPayload).kind === "view-once"
  ).length;
  if (viewOnceCount === 0) {
    return true;
  }
  // A protected photo is its own message unit: one view-once attachment, no
  // ordinary attachments riding along under the same send.
  return viewOnceCount === 1 && attachments.length === 1;
}

function isValidMediaAttachment(
  attachment: RawMediaPayload,
  policy: MediaUrlPolicy
): boolean {
  switch (attachment.kind) {
    case "gif":
    case "image": {
      return isValidMediaImage(attachment, policy);
    }
    case "video": {
      if (
        typeof attachment.url !== "string" ||
        !isValidMediaDimension(attachment.width) ||
        !isValidMediaDimension(attachment.height) ||
        !isValidMediaDuration(attachment.durationSec) ||
        !isAllowedMediaUrl(attachment.url, policy)
      ) {
        return false;
      }
      if (attachment.posterUrl === undefined) {
        return true;
      }
      return (
        typeof attachment.posterUrl === "string" &&
        isAllowedMediaUrl(attachment.posterUrl, policy)
      );
    }
    case "file": {
      if (
        typeof attachment.url !== "string" ||
        typeof attachment.filename !== "string" ||
        !FILENAME_RE.test(attachment.filename) ||
        !isAllowedMediaUrl(attachment.url, policy)
      ) {
        return false;
      }
      if (
        attachment.mimeType !== undefined &&
        (typeof attachment.mimeType !== "string" ||
          !MIME_TYPE_RE.test(attachment.mimeType))
      ) {
        return false;
      }
      if (attachment.bytes === undefined) {
        return true;
      }
      return (
        typeof attachment.bytes === "number" &&
        Number.isSafeInteger(attachment.bytes) &&
        attachment.bytes >= 0 &&
        attachment.bytes <= MAX_MEDIA_FILE_BYTES
      );
    }
    case "view-once": {
      if (
        typeof attachment.ref !== "string" ||
        !ATTACHMENT_REF_RE.test(attachment.ref) ||
        !isValidMediaDimension(attachment.width) ||
        !isValidMediaDimension(attachment.height)
      ) {
        return false;
      }
      // The protected item carries no fetchable URL by contract. A payload that
      // pairs a view-once kind with a url is refused rather than trusted.
      return attachment.url === undefined;
    }
    default: {
      return false;
    }
  }
}

function isValidMediaImageList(
  images: unknown,
  policy: MediaUrlPolicy
): boolean {
  if (
    !Array.isArray(images) ||
    images.length === 0 ||
    images.length > MAX_MESSAGE_ATTACHMENTS
  ) {
    return false;
  }
  return images.every((image) => {
    if (typeof image !== "object" || image === null) {
      return false;
    }
    return isValidMediaImage(image as RawMediaPayload, policy);
  });
}

function isValidMediaImage(
  image: RawMediaPayload,
  policy: MediaUrlPolicy
): boolean {
  if (typeof image.url !== "string") {
    return false;
  }
  if (
    !isValidMediaDimension(image.width) ||
    !isValidMediaDimension(image.height)
  ) {
    return false;
  }
  return isAllowedMediaUrl(image.url, policy);
}

// Normalizes every payload generation into one ordered attachment list, so
// ordinal pairing, the gallery, and export paths never branch on the payload
// version. A view-once item appears here as its opaque ref — callers that can
// only handle fetchable media must filter it out explicitly.
export function getMediaAttachments(
  content: Extract<MessagePayload, { type: "media" }>
): MediaAttachmentRef[] {
  if ("attachments" in content) {
    return content.attachments;
  }
  if ("images" in content) {
    return content.images.map((image) => ({ ...image, kind: content.kind }));
  }
  return [
    {
      height: content.height,
      kind: content.kind,
      url: content.url,
      width: content.width,
    },
  ];
}

// The ordinary (URL-carrying) images across every payload generation, so
// renderers, reply labels, and lightboxes never branch on the version.
// Videos, files, and view-once refs are excluded by construction.
export function getMediaImages(
  content: Extract<MessagePayload, { type: "media" }>
): MediaImageRef[] {
  return getMediaAttachments(content).flatMap((attachment) =>
    attachment.kind === "gif" || attachment.kind === "image"
      ? [
          {
            height: attachment.height,
            url: attachment.url,
            width: attachment.width,
          },
        ]
      : []
  );
}

export function isAllowedMediaUrl(
  url: string,
  policy: MediaUrlPolicy = {}
): boolean {
  if (RELATIVE_MEDIA_PATH_RE.test(url)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") {
    return true;
  }
  if (parsed.protocol === "http:") {
    const allowLoopback =
      policy.allowLoopbackHttp ?? process.env.NODE_ENV !== "production";
    if (!allowLoopback) {
      return false;
    }
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      (policy.allowEmulatorHost === true && parsed.hostname === "10.0.2.2")
    );
  }
  return false;
}

function isValidMediaDuration(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= MAX_MEDIA_DURATION_SEC)
  );
}

function isValidMediaDimension(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= MAX_MEDIA_DIMENSION)
  );
}
