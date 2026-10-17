"use client";

import { Button } from "@asm/ui/shadui/button";
import { ArrowLeft } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";

import ClientPost from "@/app/(main)/posts/[postId]/client-post";
import MediaViewer from "@/components/home/feedview/media-viewer";
import MediaRouteSkeleton from "@/components/layouts/skeletons/media-route-skeleton";
import PostDetailSkeleton from "@/components/layouts/skeletons/post-detail-skeleton";
import { getPostAttachments } from "@/lib/posts/post-normalize";
import { getPostMediaPath, getPostPath } from "@/lib/posts/post-url";
import { externalPostView } from "@/lib/posts/presentation";

import { ExternalDiscussion } from "./external-discussion";
import { ExternalResponses } from "./external-responses";
import { useExternalPost } from "./use-external-post";

export function ExternalPostPage() {
  const params = useSearchParams();
  const uri = params.get("uri") ?? "";
  const router = useRouter();
  const query = useExternalPost(uri);

  if (query.isPending) {
    return params.has("media") ? (
      <MediaRouteSkeleton />
    ) : (
      <PostDetailSkeleton />
    );
  }
  if (query.data) {
    const post = externalPostView(query.data);
    const mediaIndex = params.get("media");
    if (mediaIndex !== null && post.attachments.length) {
      return (
        <MediaViewer
          standalone
          isOpen
          initialIndex={Math.max(
            0,
            Math.min(Number(mediaIndex) || 0, post.attachments.length - 1)
          )}
          media={getPostAttachments(post)}
          post={post}
          onClose={() => router.push(getPostPath(post))}
          onNavigate={(index) =>
            router.replace(getPostMediaPath(post, index), { scroll: false })
          }
        />
      );
    }
    return <ClientPost key={post.id} post={post} userData={null} />;
  }
  return (
    <main className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          aria-label="Go back"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push("/")
          }
          size="icon"
          variant="ghost"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-lg font-semibold">Post</h1>
      </div>
      {query.isError ? (
        <Button
          onClick={() => {
            void query.refetch();
          }}
          variant="ghost"
        >
          Couldn't load post. Retry
        </Button>
      ) : null}
      {query.isSuccess ? (
        <>
          <p className="text-muted-foreground p-4">
            The source post is unavailable. ASM discussion is preserved.
          </p>
          <ExternalDiscussion post={{ id: uri }} />
          <ExternalResponses uri={uri} />
        </>
      ) : null}
    </main>
  );
}
