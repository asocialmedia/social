"use client";

import type { PostData } from "@asm/db";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import MediaViewer from "@/components/home/feedview/media-viewer";
import { useFeedSwipeNavigation } from "@/hooks/use-feed-swipe-navigation";
import { getPostMediaPath, getPostPath } from "@/lib/seo";

// Renders the media viewer as the media page itself (not an overlay on the post
// page). Navigating here jumps straight to a fullscreen media screen; closing
// returns to the post. Prev/next update the URL index in place.
interface MediaPageProps {
  initialMediaIndex: number;
  post: PostData;
}

export default function MediaPage({ initialMediaIndex, post }: MediaPageProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    // The media page is reached either by pushing from the post page or by a
    // direct URL. Go back when there's a prior entry (post page), otherwise
    // replace with the post page so closing never strands the viewer.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.replace(getPostPath(post));
    }
  }, [post, router]);

  const handleNavigate = useCallback(
    (index: number) => {
      // Update the URL for shareability without triggering a Next.js
      // server navigation — the viewer already manages currentIndex
      // locally, so a router.replace would remount the page and look
      // like a full refresh.
      window.history.replaceState(null, "", getPostMediaPath(post, index));
    },
    [post]
  );

  const authorUsername = post.user?.username;
  // Mobile swipes: a right-to-left slide opens the author's profile. The hook
  // only binds below md, so desktop keyboard/button navigation is untouched.
  const handleSwipeNavigate = useCallback(
    (direction: -1 | 1) => {
      if (direction === 1 && authorUsername) {
        router.push(`/users/${authorUsername}`);
      }
    },
    [authorUsername, router]
  );
  useFeedSwipeNavigation(containerRef, handleSwipeNavigate);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden overscroll-none"
    >
      <MediaViewer
        initialIndex={initialMediaIndex}
        isOpen
        media={post.attachments}
        onClose={handleClose}
        onNavigate={handleNavigate}
        post={post}
        standalone
      />
    </div>
  );
}
