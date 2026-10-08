export const MESSAGE_SEARCH_MINIMUM_QUERY_LENGTH = 2;
export const MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS = 256;
export const MESSAGE_SEARCH_TERM_CHUNK_SIZE = 512;
export const MESSAGE_SEARCH_TERM_CHUNK_OVERLAP = 255;
export const MESSAGE_SEARCH_NORMALIZATION_VERSION = 1;

export interface MessageSearchFeatureFlagEnvironment {
  MESSAGE_SEARCH_BACKFILL_ENABLED?: string;
  MESSAGE_SEARCH_COUNT_ENABLED?: string;
  MESSAGE_SEARCH_SERVER_ENABLED?: string;
}

export interface MessageSearchFeatureFlags {
  backfill: boolean;
  counts: boolean;
  serverSearch: boolean;
}

function isMessageSearchFeatureEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no" ||
    normalized === "disabled"
  ) {
    return false;
  }
  return true;
}

export function readMessageSearchFeatureFlags(
  environment: MessageSearchFeatureFlagEnvironment
): MessageSearchFeatureFlags {
  return {
    backfill: isMessageSearchFeatureEnabled(
      environment.MESSAGE_SEARCH_BACKFILL_ENABLED
    ),
    counts: isMessageSearchFeatureEnabled(
      environment.MESSAGE_SEARCH_COUNT_ENABLED
    ),
    serverSearch: isMessageSearchFeatureEnabled(
      environment.MESSAGE_SEARCH_SERVER_ENABLED
    ),
  };
}

export interface MessageSearchablePayload {
  content?: string;
  images?: number | readonly unknown[];
  kind?: "gif" | "image";
  type: "media" | "post" | "text";
}

export function searchableTextFromPayload(
  payload: MessageSearchablePayload
): string {
  const content = payload.content?.trim() ?? "";
  if (payload.type === "text") {
    return payload.content ?? "";
  }
  if (payload.type === "post") {
    return content.length > 0 ? `${content} Shared a post` : "Shared a post";
  }

  let imageCount = 1;
  if (Array.isArray(payload.images)) {
    imageCount = payload.images.length;
  } else if (typeof payload.images === "number") {
    imageCount = payload.images;
  }

  let label = "Shared an image";
  if (payload.kind === "gif") {
    label = "Shared a GIF";
  } else if (imageCount > 1) {
    label = `Shared ${imageCount} images`;
  }
  return content.length > 0 ? `${content} ${label}` : label;
}
