"use client";

import Link from "next/link";

import { BlueskyPostCard } from "@/components/protocols/bluesky-post-card";
import Linkify from "@/helpers/global/linkify";
import type { ExternalProfileActivityItem } from "@/lib/protocols/profile-activity-schema";
import { profilePath } from "@/lib/users/profile-path";
import { formatRelativeDate } from "@/lib/utils";

export function ExternalActivityCard({
  item,
}: {
  item: ExternalProfileActivityItem;
}) {
  return (
    <div data-profile-external-activity={item.id}>
      {item.comment ? (
        <div className="border-border/60 border-b px-4 py-3">
          <Link
            className="font-semibold"
            href={profilePath(item.comment.user?.username ?? "deleted")}
          >
            {item.comment.user?.displayName ||
              item.comment.user?.username ||
              "Deleted User"}
          </Link>
          <Link
            className="text-muted-foreground ml-2 text-xs"
            href={`/network/bluesky?uri=${encodeURIComponent(item.uri)}`}
          >
            {formatRelativeDate(item.createdAt)}
          </Link>
          <p className="text-muted-foreground mt-1 text-xs">
            Replying to a Bluesky post
          </p>
          <div className="mt-2 text-sm break-words whitespace-pre-line">
            {item.comment.withheld ? (
              "This eddie is hidden by your content settings."
            ) : (
              <Linkify>{item.comment.content}</Linkify>
            )}
          </div>
        </div>
      ) : null}
      {item.post ? (
        <BlueskyPostCard post={item.post} />
      ) : (
        <Link
          className="text-muted-foreground block p-4 text-sm"
          href={`/network/bluesky?uri=${encodeURIComponent(item.uri)}`}
        >
          Source post unavailable. Open asocialmedia discussion.
        </Link>
      )}
    </div>
  );
}
