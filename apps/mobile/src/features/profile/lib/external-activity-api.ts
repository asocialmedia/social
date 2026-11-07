import { networkRequest } from "@/features/network/lib/network-api";

import { externalProfileActivityPageSchema } from "./profile-activity-schema";
import type {
  ExternalProfileActivityKind,
  ExternalProfileActivityPage,
  ProfileActivityCursor,
} from "./profile-activity-schema";

export function buildExternalActivityPath(
  userId: string,
  kind: ExternalProfileActivityKind,
  cursor: ProfileActivityCursor | null
): string {
  const params = new URLSearchParams({ kind });
  if (cursor) {
    params.set("cursor", JSON.stringify(cursor));
  }
  return `/api/users/${encodeURIComponent(userId)}/external-activity?${params}`;
}

export async function readExternalProfileActivity(
  userId: string,
  kind: ExternalProfileActivityKind,
  cursor: ProfileActivityCursor | null,
  signal?: AbortSignal
): Promise<ExternalProfileActivityPage> {
  return externalProfileActivityPageSchema.parse(
    await networkRequest(buildExternalActivityPath(userId, kind, cursor), {
      signal,
    })
  );
}
