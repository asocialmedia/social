import type { CommentsPage, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noCommentsImage from "@assets/general/nocomments.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback } from "react";
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

  const handleLoadPrevious = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  if (status === "pending") {
    return <CommentsSkeleton />;
  }

  return (
    <div className="mt-4 space-y-3">
      <CommentInput post={post} />
      {hasNextPage ? (
        <Button
          className="mx-auto block"
          disabled={isFetching}
          onClick={handleLoadPrevious}
          variant="link"
        >
          Load previous eddies
        </Button>
      ) : null}
      {status === "success" && !comments.length && (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Image
            alt=""
            className="h-40 w-auto object-contain"
            draggable={false}
            height={1024}
            src={noCommentsImage}
            width={1536}
          />
          <p className="text-muted-foreground text-sm">No eddy yet.</p>
        </div>
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
