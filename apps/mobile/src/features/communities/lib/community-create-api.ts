import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { withAuthHeaders } from "@/lib/network/auth-headers";

import type { CommunityDraft } from "./community-create-contract";

export type CommunityCreateResult =
  | { kind: "success"; slug: string }
  | { kind: "install-token-required" }
  | { kind: "error"; message: string };
export async function createCommunity(
  draft: CommunityDraft,
  options: ApiCallOptions
): Promise<CommunityCreateResult> {
  try {
    const response = await (options.baseFetch ?? fetch)(
      `${options.apiBase}/api/communities`,
      {
        body: JSON.stringify(draft),
        headers: withAuthHeaders(
          { "Content-Type": "application/json" },
          options.cookie
        ),
        method: "POST",
      }
    );
    const payload: unknown = await response.json().catch(() => null);
    if (payload && typeof payload === "object") {
      if (
        response.ok &&
        "slug" in payload &&
        typeof payload.slug === "string"
      ) {
        return { kind: "success", slug: payload.slug };
      }
      if (
        response.status === 403 &&
        "error" in payload &&
        payload.error === "install-token-required"
      ) {
        return { kind: "install-token-required" };
      }
      if (
        response.status < 500 &&
        "error" in payload &&
        typeof payload.error === "string"
      ) {
        return { kind: "error", message: payload.error };
      }
    }
    return {
      kind: "error",
      message: "We couldn’t create that community. Please try again.",
    };
  } catch {
    return {
      kind: "error",
      message: "Check your connection, then try again. Your draft is saved.",
    };
  }
}
