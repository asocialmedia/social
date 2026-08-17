"use client";

import type { PostData } from "@asm/db";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import MediaViewer from "@/components/home/feedview/media-viewer";

// Renders the media viewer as the media page itself (not an overlay on the post
// page). Navigating here jumps straight to a fullscreen media screen; closing
// returns to the post. Prev/next update the URL index in place.
interface MediaPageProps {
  initialMediaIndex: number;
  post: PostData;
}

export default function MediaPage({ initialMediaIndex, post }: MediaPageProps) {
  const router = useRouter();

  const handleClose = useCallback(() => {
    // The media page is reached either by pushing from the post page or by a
    // direct URL. Go back when there's a prior entry (post page), otherwise
    // replace with the post page so closing never strands the viewer.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.replace(`/posts/${post.id}`);
    }
  }, [post.id, router]);

  const handleNavigate = useCallback(
    (index: number) => {
      router.replace(`/posts/${post.id}/media/${index}`);
    },
    [post.id, router]
  );

  return (
    <MediaViewer
      initialIndex={initialMediaIndex}
      isOpen
      media={post.attachments}
      onClose={handleClose}
      onNavigate={handleNavigate}
      post={post}
    />
  );
}
