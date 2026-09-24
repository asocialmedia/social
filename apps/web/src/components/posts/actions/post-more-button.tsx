import type { PostData, UserData } from "@asm/db";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import {
  Captions,
  EyeOff,
  Hash,
  MoreHorizontal,
  Share2,
  ShieldCheck,
  Subtitles,
  Trash2,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  clearRecommendationNotInterested,
  markRecommendationNotInterested,
} from "@/components/recommendations/recommendation-tracker";
import { PostMetaEditorDialog } from "@/components/tags/post-meta-editor-dialog";
import { useToast } from "@/lib/gooey-toast";
import { canModeratePost } from "@/lib/moderation/moderation";
import { setPopupOpen } from "@/lib/popup-tracker";
import { getPostAttachments } from "@/lib/posts/post-normalize";
import { toggleAltReveal, useAltRevealed } from "@/lib/stores/alt-reveal-store";
import { useVideoCaptionsStore } from "@/lib/stores/video-captions-store";
import { cn } from "@/lib/utils";
import {
  useHideRecommendationPostMutation,
  useUnhideRecommendationPostMutation,
} from "@/recommendations/mutations";
import { useComposerStore } from "@/store/composer-store";

import DeletePostDialog from "./delete-post-dialog";
import PostModerationDialog from "./post-moderation-dialog";

interface PostMoreButtonProps {
  className?: string;
  // Extra entries rendered at the top of the dropdown (e.g. the gust player's
  // captions and transcript toggles), styled like the built-in items.
  extraItems?: React.ReactNode;
  post: PostData;
  /** Applies the media page's dark 3D chip styling (same look as the mobile
   * viewer's control buttons) instead of the default pill hover treatment. */
  variant?: "default" | "media-page";
}

export default function PostMoreButton({
  post,
  className,
  variant = "default",
  extraItems,
}: PostMoreButtonProps) {
  const { user } = useSession();
  const { toast } = useToast();
  const openComposerForCommunityShare = useComposerStore(
    (state) => state.openComposerForCommunityShare
  );
  const hideMutation = useHideRecommendationPostMutation();
  const unhideMutation = useUnhideRecommendationPostMutation();
  // The in-flight durable hide per post, so Undo can wait for it before
  // un-hiding (see handleNotInterested).
  const pendingHideRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showModerationDialog, setShowModerationDialog] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Moderators are the app admin and the author of the post itself. Guests and
  // other users never see the moderation entries.
  const canModerate = canModeratePost(user, post);
  // Edit and hard-delete stay author-only (their server actions check
  // ownership), so a moderator who isn't the author only gets the reversible
  // moderation flags.
  const isOwner = Boolean(user && user.id === post.user.id);
  // Anyone may view alt text - it is reader accessibility info, not an
  // authoring or moderation surface. The toggle reveals it inline below the
  // media grid, so the entry only appears when something is described.
  const attachments = getPostAttachments(post);
  const hasAltText = attachments.some((attachment) => attachment.altText);
  const isAltRevealed = useAltRevealed(post.id);
  const hasVideo = attachments.some(
    (attachment) => attachment.type === "VIDEO"
  );
  const showCaptions = useVideoCaptionsStore((state) => state.showCaptions);
  const toggleCaptions = useVideoCaptionsStore((state) => state.toggleCaptions);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    setPopupOpen(open);
  }, []);

  const handleShowDeleteDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
    setPopupOpen(true);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setShowDeleteDialog(false);
    setPopupOpen(false);
  }, []);

  const handleShowEditDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowEditDialog(true);
    setPopupOpen(true);
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    setShowEditDialog(false);
    setPopupOpen(false);
  }, []);

  const handleShowModerationDialog = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModerationDialog(true);
    setPopupOpen(true);
  }, []);

  const handleCloseModerationDialog = useCallback(() => {
    setShowModerationDialog(false);
    setPopupOpen(false);
  }, []);

  const handleToggleAlt = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleAltReveal(post.id);
    },
    [post.id]
  );

  const handleToggleCaptions = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleCaptions();
    },
    [toggleCaptions]
  );

  const handleTriggerClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
    },
    []
  );

  const handleNotInterested = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // Hide everywhere immediately, then persist. The toast's Undo reverses
      // both the local hide and the server write, so a mis-tap costs nothing.
      markRecommendationNotInterested(post.id);
      // Never-rejecting wrapper: the durable write is best-effort (the local
      // hide already applied) and Undo awaits it, so a rejection must not
      // surface as an unhandled promise.
      const hidePromise = (async () => {
        try {
          await hideMutation.mutateAsync(post.id);
        } catch {
          // Local hide stands; the server write is best-effort.
        }
      })();
      pendingHideRef.current.set(post.id, hidePromise);
      setIsOpen(false);
      setPopupOpen(false);
      toast({
        button: {
          onClick: () => {
            // Undo must not overtake the hide: run the un-hide only once the
            // hide has settled, or a slow hide could land last and re-mark the
            // post NOT_INTERESTED after the viewer undid it.
            void (async () => {
              clearRecommendationNotInterested(post.id);
              const pending = pendingHideRef.current.get(post.id);
              await pending;
              // A newer hide may have replaced this one while we waited. Only
              // clear the mapping and un-hide if this is still the latest hide
              // for the post, otherwise the newer hide owns the lifecycle.
              if (pendingHideRef.current.get(post.id) !== pending) {
                return;
              }
              pendingHideRef.current.delete(post.id);
              unhideMutation.mutate(post.id);
            })();
          },
          title: "Undo",
        },
        description: "You'll see fewer posts like this.",
        duration: 6000,
        title: "Not interested",
      });
    },
    [hideMutation, post.id, toast, unhideMutation]
  );

  // Reshare a community post onto the global feed: opens the composer with the
  // source attached, which publishes a new post + CommunityPostShare side row.
  const handleShareToFeed = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!post.community) {
        return;
      }
      openComposerForCommunityShare({
        accentColor: post.community.accentColor,
        communityName: post.community.name,
        communitySlug: post.community.slug,
        sourcePostId: post.id,
      });
      setIsOpen(false);
      setPopupOpen(false);
    },
    [post.community, post.id, openComposerForCommunityShare]
  );

  return (
    <>
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Post options"
            className={cn(
              variant === "media-page"
                ? "group inline-flex h-10 w-10 items-center justify-center rounded-full border-0 bg-linear-to-b from-[#3a3f4a] to-[#23262e] p-0 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15),inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_6px_rgba(0,0,0,0.35)] transition-all duration-200 hover:brightness-110 active:translate-y-px"
                : "pill-3d-hover group text-muted-foreground inline-flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 active:translate-y-px sm:h-7.5 sm:w-7.5",
              className,
              isOpen ? "opacity-100" : undefined
            )}
            onClick={handleTriggerClick}
            type="button"
          >
            <MoreHorizontal className="size-4 sm:size-4.5" />
          </button>
        </DropdownMenuTrigger>
        {/* `apple-panel` (deprecated, unlayered) used to sit here and fought
            the primitive's `panel-3d` surface; dropping it lets the shared
            3D recipe - and its now-rounded corners - apply. */}
        <DropdownMenuContent align="end" className="p-1.5">
          {extraItems}
          {user && post.community && !post.moderated ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleShareToFeed}
            >
              <span className="flex items-center gap-3">
                <Share2 className="size-4" />
                Share to feed
              </span>
            </DropdownMenuItem>
          ) : null}
          {user && !isOwner ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleNotInterested}
            >
              <span className="flex items-center gap-3">
                <EyeOff className="size-4" />
                Not interested
              </span>
            </DropdownMenuItem>
          ) : null}
          {canModerate ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleShowModerationDialog}
            >
              <span className="flex items-center gap-3">
                <ShieldCheck className="size-4" />
                Moderation
              </span>
            </DropdownMenuItem>
          ) : null}
          {hasAltText ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleToggleAlt}
            >
              <span className="flex items-center gap-3">
                <Captions className="size-4" />
                {isAltRevealed ? "Hide alt" : "Show alt"}
              </span>
            </DropdownMenuItem>
          ) : null}
          {hasVideo && !post.moderated ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleToggleCaptions}
            >
              <span className="flex items-center gap-3">
                <Subtitles className="size-4" />
                {showCaptions ? "Hide captions" : "Show captions"}
              </span>
            </DropdownMenuItem>
          ) : null}
          {isOwner ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleShowEditDialog}
            >
              <span className="flex items-center gap-3">
                <Hash className="size-4" />
                Edit tags &amp; mentions
              </span>
            </DropdownMenuItem>
          ) : null}
          {isOwner ? (
            <DropdownMenuItem
              className="pill-3d-hover rounded-md px-2 py-2"
              onClick={handleShowDeleteDialog}
            >
              <span className="text-destructive flex items-center gap-3">
                <Trash2 className="size-4" />
                Delete
              </span>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canModerate ? (
        <PostModerationDialog
          onClose={handleCloseModerationDialog}
          open={showModerationDialog}
          post={post}
        />
      ) : null}

      <DeletePostDialog
        onClose={handleCloseDeleteDialog}
        open={showDeleteDialog}
        post={post}
      />

      <PostMetaEditorDialog
        mentions={(post.mentions ?? []).map(
          (m) => (m as unknown as { user: UserData }).user
        )}
        onClose={handleCloseEditDialog}
        open={showEditDialog}
        postId={post.id}
        tags={post.tags ?? []}
      />
    </>
  );
}
