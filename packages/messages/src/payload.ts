import { MAX_MESSAGE_ATTACHMENTS } from "@asm/media";

export interface MediaImageRef {
  height?: number;
  url: string;
  width?: number;
}

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
      url: string;
      content?: string;
      width?: number;
      height?: number;
      replyToId?: string;
      replyToSenderId?: string;
    };

export function parseMessagePayload(plaintext: string): MessagePayload {
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
    if (!isValidMediaPayload(payload)) {
      throw new Error("Invalid media payload");
    }
    if (payload.content !== undefined && typeof payload.content !== "string") {
      throw new Error("Invalid media caption");
    }
  }
  return payload as MessagePayload;
}

// Match proxy paths without passing protocol-relative or traversal input to URL parsing.
const RELATIVE_MEDIA_PATH_RE =
  /^\/api\/media\/[A-Za-z0-9_-]+(?:\/v\/[A-Za-z0-9.-]+)?(?:\?[A-Za-z0-9_=&%.-]+)?$/;

interface RawMediaPayload {
  height?: unknown;
  images?: unknown;
  kind?: unknown;
  url?: unknown;
  width?: unknown;
}

function isValidMediaPayload(
  payload: Partial<Extract<MessagePayload, { type: "media" }>>
): boolean {
  const raw = payload as RawMediaPayload;
  if (raw.kind !== "gif" && raw.kind !== "image") {
    return false;
  }
  // Key presence distinguishes malformed grouped payloads from legacy single-image rows.
  if ("images" in raw) {
    return isValidMediaImageList(raw.images);
  }
  return isValidMediaImage(raw);
}

function isValidMediaImageList(images: unknown): boolean {
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
    return isValidMediaImage(image as RawMediaPayload);
  });
}

function isValidMediaImage(image: RawMediaPayload): boolean {
  if (typeof image.url !== "string") {
    return false;
  }
  if (
    !isValidMediaDimension(image.width) ||
    !isValidMediaDimension(image.height)
  ) {
    return false;
  }
  return isAllowedMediaUrl(image.url);
}

function isAllowedMediaUrl(url: string): boolean {
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
    // Insecure URLs are limited to local development endpoints.
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    return process.env.NODE_ENV !== "production" && isLoopback;
  }
  return false;
}

const MAX_MEDIA_DIMENSION = 16_384;

function isValidMediaDimension(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= MAX_MEDIA_DIMENSION)
  );
}
