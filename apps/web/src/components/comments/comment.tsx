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
    <div className="group/comment flex gap-3 py-3">
      <span className="hidden sm:inline">
        <UserTooltip user={comment.user}>
          <Link href={`/users/${comment.user.username}`}>
            <UserAvatar avatarUrl={comment.user.avatarUrl} size={40} />
          </Link>
        </UserTooltip>
      </span>
      <div>
        <div className="flex items-center gap-1 text-sm">
          <UserTooltip user={comment.user}>
            <Link
              className="font-medium hover:underline"
              href={`/users/${comment.user.username}`}
            >
              {comment.user.displayName}
            </Link>
          </UserTooltip>
          <span className="text-muted-foreground">
            {formatRelativeDate(comment.createdAt)}
          </span>
        </div>
        <UserTooltip user={comment.user}>
          <Linkify>{comment.content}</Linkify>
        </UserTooltip>
      </div>
      {comment.user.id === user.id && (
        <CommentMoreButton
          className="ms-auto opacity-0 transition-opacity group-hover/comment:opacity-100"
          comment={comment}
        />
      )}
    </div>
  );
}
