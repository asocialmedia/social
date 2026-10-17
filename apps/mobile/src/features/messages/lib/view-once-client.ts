import { LIFECYCLE_CAPABILITY } from "@asm/messages";
import { Directory, File, Paths } from "expo-file-system";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { withAuthHeaders } from "@/lib/auth-headers";

export class ViewOnceMediaError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ViewOnceMediaError";
    this.status = status;
  }
}

function viewOncePath(conversationId: string, mediaId: string): string {
  return `/api/messages/conversations/${conversationId}/media/${mediaId}/view-once`;
}

let cachePrepared = false;

function viewOnceCache(): Directory {
  const directory = new Directory(Paths.cache, "asm-view-once");
  if (!cachePrepared) {
    if (directory.exists) {
      directory.delete();
    }
    directory.create({ idempotent: true, intermediates: true });
    cachePrepared = true;
  }
  return directory;
}

export function deleteViewOncePhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // A stale file is swept before the next app process can open a protected photo.
  }
}

async function parseViewOnceError(
  response: Response
): Promise<ViewOnceMediaError> {
  let message = "This photo couldn't be opened. Try again.";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // A short, safe fallback is preferable to exposing a proxy or storage response.
  }
  return new ViewOnceMediaError(message, response.status);
}

export async function closeViewOnceMedia(
  conversationId: string,
  mediaId: string,
  grantId: string,
  options: ApiCallOptions
): Promise<void> {
  const baseFetch = options.baseFetch ?? fetch;
  const response = await baseFetch(
    `${options.apiBase}${viewOncePath(conversationId, mediaId)}/close`,
    {
      body: JSON.stringify({ grantId }),
      headers: withAuthHeaders(
        {
          "Content-Type": "application/json",
          "X-Chat-Capability": LIFECYCLE_CAPABILITY,
        },
        options.cookie
      ),
      method: "POST",
      signal: AbortSignal.timeout(5000),
    }
  );
  if (!response.ok) {
    throw await parseViewOnceError(response);
  }
}

export async function openViewOnceMedia(
  conversationId: string,
  mediaId: string,
  grantId: string,
  options: ApiCallOptions,
  signal?: AbortSignal
): Promise<string> {
  const baseFetch = options.baseFetch ?? fetch;
  const path = viewOncePath(conversationId, mediaId);
  const headers = withAuthHeaders(
    {
      "X-Chat-Capability": LIFECYCLE_CAPABILITY,
      "X-View-Once-Grant": grantId,
    },
    options.cookie
  );
  const reservation = await baseFetch(`${options.apiBase}${path}/open`, {
    headers,
    method: "POST",
    signal,
  });
  if (!reservation.ok) {
    throw await parseViewOnceError(reservation);
  }

  const destination = new File(viewOnceCache(), `${grantId}.image`);
  try {
    const downloaded = await File.downloadFileAsync(
      `${options.apiBase}${path}/open`,
      destination,
      { headers, idempotent: true, signal }
    );
    signal?.throwIfAborted();
    return downloaded.uri;
  } catch (error) {
    deleteViewOncePhoto(destination.uri);
    try {
      await closeViewOnceMedia(conversationId, mediaId, grantId, options);
    } catch {
      // The server expires abandoned grants after a short viewing window.
    }
    if (error instanceof ViewOnceMediaError) {
      throw error;
    }
    if (signal?.aborted) {
      throw error;
    }
    throw new ViewOnceMediaError(
      "This photo couldn't be loaded. It may no longer be available.",
      503
    );
  }
}
