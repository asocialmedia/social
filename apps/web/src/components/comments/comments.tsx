import { useInfiniteQuery } from "@tanstack/react-query";
import type { CommentsPage, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import CommentsSkeleton from "@/components/layouts/skeletons/comments-skeleton";
import kyInstance from "@/lib/ky";
import Comment from "./comment";
import CommentInput from "./comment-input";

interface CommentsProps {
  post: PostData;
}

export default function Comments({ post }: CommentsProps) {
  const { data, fetchNextPage, hasNextPage, isFetching, status } =
    useInfiniteQuery({
      queryKey: ["comments", post.id],
      queryFn: ({ pageParam }) =>
        kyInstance
          .get(
            `/api/posts/${post.id}/comments`,
            pageParam ? { searchParams: { cursor: pageParam } } : {}
          )
          .json<CommentsPage>(),
      initialPageParam: null as string | null,
      getNextPageParam: (firstPage) => firstPage.previousCursor,
      select: (commentsData) => ({
        pages: [...commentsData.pages].reverse(),
        pageParams: [...commentsData.pageParams].reverse(),
      }),
    });

  const comments = data?.pages.flatMap((page) => page.comments) || [];

  if (status === "pending") {
    return <CommentsSkeleton />;
  }

  return (
    <div className="mt-4 space-y-3">
      <CommentInput post={post} />
      {hasNextPage && (
        <Button
          className="mx-auto block"
          disabled={isFetching}
          onClick={() => fetchNextPage()}
          variant="link"
        >
          Load previous eddies
        </Button>
      )}
      {status === "success" && !comments.length && (
        <p className="text-center text-muted-foreground">No eddy yet.</p>
      )}
      {status === "error" && (
        <p className="text-center text-destructive">
          An error occurred while loading eddies.
        </p>
      )}
      <div className="divide-y">
        {comments.map((comment) => (
          <Comment comment={comment} key={comment.id} />
        ))}
      </div>
    </div>
  );
}
