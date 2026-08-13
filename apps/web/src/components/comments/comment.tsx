import type { CommentData } from "@asm/db";
import Link from "next/link";
import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import UserTooltip from "@/components/layouts/user-tooltip";
import Linkify from "@/helpers/global/linkify";
import { formatRelativeDate } from "@/lib/utils";
import CommentMoreButton from "./comment-more-button";

interface CommentProps {
  comment: CommentData;
}

export default function Comment({ comment }: CommentProps) {
  const { user } = useSession();

  return (
    <div className="group/comment flex gap-3 pt-3 pb-3 first:pt-1.5">
      <UserTooltip user={comment.user}>
        <Link className="shrink-0" href={`/users/${comment.user.username}`}>
          <UserAvatar
            avatarUrl={comment.user.avatarUrl}
            className="h-10 w-10"
          />
        </Link>
      </UserTooltip>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <UserTooltip user={comment.user}>
            <Link
              className="truncate font-semibold text-foreground hover:underline"
              href={`/users/${comment.user.username}`}
            >
              {comment.user.displayName}
            </Link>
          </UserTooltip>
          <Link
            className="truncate text-muted-foreground hover:underline"
            href={`/users/${comment.user.username}`}
          >
            @{comment.user.username}
          </Link>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span
            className="shrink-0 text-muted-foreground"
            suppressHydrationWarning
          >
            {formatRelativeDate(comment.createdAt)}
          </span>
        </div>

        <UserTooltip user={comment.user}>
          <Linkify>
            <p className="wrap-break-word max-w-full whitespace-pre-wrap text-[15px] text-foreground leading-relaxed">
              {comment.content}
            </p>
          </Linkify>
        </UserTooltip>
      </div>

      {comment.user.id === user.id && (
        <CommentMoreButton
          className="shrink-0 opacity-0 transition-opacity group-hover/comment:opacity-100"
          comment={comment}
        />
      )}
    </div>
  );
}
