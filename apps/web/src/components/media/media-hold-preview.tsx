"use client";

import type { PostData } from "@asm/db";
import {
  Drawer,
  DrawerDescription,
  DrawerHandle,
  DrawerOverlay,
  DrawerPortal,
  DrawerSurface,
  DrawerTitle,
} from "@asm/ui/shadui/drawer";
import { useQuery } from "@tanstack/react-query";
import {
  CornerDownRight,
  Download,
  Maximize2,
  MessageSquare,
  Share2,
  VolumeX,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import BookmarkButton from "@/components/posts/actions/bookmark-button";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { setPopupOpen } from "@/lib/popup-tracker";
import { isBookmarkedByUser } from "@/lib/posts/post-normalize";
import { getPostMediaPath, getPostPath } from "@/lib/seo/seo";
import type { Media } from "@/lib/types";
import { getMediaProxyUrl, getMediaVideoUrl } from "@/lib/utils/image-url";
import { useComposerStore } from "@/store/composer-store";

import type { MediaBounds } from "./media-hold-gesture";
import { mediaHoldPreviewLayout } from "./media-hold-layout";
import {
  MEDIA_MENU_ACTION_CLASS,
  MediaMenuActionContent,
} from "./media-menu-action";
import { shareHeldMedia } from "./share-held-media";

export interface MediaHoldRequest {
  bounds: MediaBounds;
  media: Media;
  post?: PostData;
  postId: string;
  sourceVideo?: HTMLVideoElement;
}

function viewportSize() {
  const viewport = window.visualViewport;
  return {
    height: viewport?.height ?? window.innerHeight,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
  };
}

export function MediaHoldPreview({
  request,
  onClose,
}: {
  request: MediaHoldRequest;
  onClose: () => void;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(true);
  const {
    data: post,
    isError: loadFailed,
    refetch,
  } = useQuery({
    enabled: !request.post,
    initialData: request.post,
    queryFn: async ({ signal }) => {
      const result = await kyInstance
        .get(`/api/posts/${request.postId}`, { signal })
        .json<{ post: PostData }>();
      return result.post;
    },
    queryKey: ["media-hold-post", request.postId],
    retry: false,
  });
  const [sharing, setSharing] = useState(false);
  const [viewport, setViewport] = useState(viewportSize);
  const [dimensions, setDimensions] = useState({
    height: request.media.height,
    width: request.media.width,
  });
  const [sheetHeight, setSheetHeight] = useState(() =>
    Math.min(viewport.height * 0.48, 404)
  );
  const measureSheet = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      return;
    }
    const update = () => setSheetHeight(element.offsetHeight);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const video = useRef<HTMLVideoElement>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const closing = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const close = useCallback((next?: () => void) => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    afterClose.current = next ?? null;
    setOpen(false);
  }, []);
  useEffect(() => {
    const source = request.sourceVideo;
    const wasPlaying = source && !source.paused;
    source?.pause();
    return () => {
      if (wasPlaying && source.isConnected) {
        void resumeVideo(source);
      }
    };
  }, [request]);
  useEffect(() => {
    if (open) {
      return;
    }
    // Vaul only calls onAnimationEnd for its own gestures, not controlled action closes.
    const timer = setTimeout(() => {
      onClose();
      afterClose.current?.();
    }, 500);
    return () => clearTimeout(timer);
  }, [onClose, open]);
  useEffect(() => {
    setPopupOpen(true);
    return () => {
      setPopupOpen(false);
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const update = () => setViewport(viewportSize());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    if (!open) {
      video.current?.pause();
    }
    const visibility = () => {
      const player = video.current;
      if (document.hidden) {
        player?.pause();
      } else if (open) {
        void resumeVideo(player);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [open]);
  const target = mediaHoldPreviewLayout(
    viewport,
    dimensions,
    request.bounds,
    sheetHeight
  );
  const selected = request.media;
  const requireUser = (action: () => void) => {
    if (user) {
      action();
    } else {
      close(() =>
        router.push(
          `/login?next=${encodeURIComponent(getPostPath({ id: request.postId }))}`
        )
      );
    }
  };
  const share = async () => {
    if (sharing) {
      return;
    }
    setSharing(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const copied = await shareHeldMedia(selected, controller.signal);
      if (copied) {
        toast({ title: "Media link copied" });
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        toast({
          description: "Try saving the media first.",
          title: "Couldn't share media",
          variant: "destructive",
        });
      }
    }
    setSharing(false);
  };
  return (
    <Drawer
      autoFocus
      open={open}
      shouldScaleBackground={false}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DrawerPortal>
        <DrawerOverlay
          className="bg-black/78"
          data-media-hold-portal
          onClick={(event) => event.stopPropagation()}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 overflow-hidden rounded-[18px] border border-white/20 bg-[#161616]"
          initial={
            reducedMotion ? { ...target, opacity: 0 } : { ...request.bounds }
          }
          animate={
            open
              ? { ...target, opacity: 1 }
              : { ...(reducedMotion ? target : request.bounds), opacity: 0 }
          }
          transition={{
            duration: reducedMotion ? 0.12 : 0.3,
            ease: [0.16, 1, 0.3, 1],
          }}
          data-media-hold-portal
          data-media-hold-preview
        >
          {selected.type === "VIDEO" ? (
            <>
              <video
                aria-label="Preview video"
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                ref={video}
                poster={getMediaProxyUrl(selected)}
                className="h-full w-full object-contain"
                src={getMediaVideoUrl(selected.id)}
                onLoadedMetadata={(event) =>
                  setDimensions({
                    height: event.currentTarget.videoHeight,
                    width: event.currentTarget.videoWidth,
                  })
                }
              />
              <span className="absolute right-3 bottom-3 flex size-7 items-center justify-center rounded-full bg-black/50 text-white">
                <VolumeX className="size-4" />
              </span>
            </>
          ) : (
            <Image
              alt={selected.altText || "Media preview"}
              src={getMediaProxyUrl(selected)}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain"
              onLoad={(event) =>
                setDimensions({
                  height: event.currentTarget.naturalHeight,
                  width: event.currentTarget.naturalWidth,
                })
              }
            />
          )}
        </motion.div>
        <DrawerSurface
          ref={measureSheet}
          data-media-hold-portal
          data-media-actions-sheet
          className="panel-3d fixed inset-x-0 bottom-0 z-50 flex h-[min(48dvh,calc(392px+env(safe-area-inset-bottom)))] flex-col overflow-hidden rounded-t-[28px]! rounded-b-none! pb-[max(12px,env(safe-area-inset-bottom))] outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          <DrawerTitle className="sr-only">Media actions</DrawerTitle>
          <DrawerDescription className="sr-only">
            Preview this media, save or share it, and interact with its post.
          </DrawerDescription>
          <div className="relative flex h-8 shrink-0 items-center justify-center">
            <DrawerHandle className="bg-muted-foreground/70 h-1 w-9 rounded-full" />
            <button
              aria-label="Close media preview"
              className="focus-visible:ring-ring text-muted-foreground absolute top-0 right-2 flex size-8 items-center justify-center rounded-full outline-none focus-visible:ring-2"
              onClick={() => close()}
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-0.5">
            {post ? (
              <div className="flex flex-col gap-1">
                <AuraVoteButton
                  layout="menu"
                  authorName={
                    post.user?.displayName || post.user?.username || "Author"
                  }
                  initialState={{
                    aura: post.aura ?? 0,
                    userVote: post.vote?.[0]?.value ?? 0,
                  }}
                  postId={post.id}
                />
                <a
                  className={MEDIA_MENU_ACTION_CLASS}
                  href={`/api/media/download/${selected.id}`}
                  download
                >
                  <MediaMenuActionContent icon={Download} label="Save media" />
                </a>
                <button
                  className={MEDIA_MENU_ACTION_CLASS}
                  disabled={sharing}
                  onClick={() => {
                    void share();
                  }}
                  type="button"
                >
                  <MediaMenuActionContent
                    icon={Share2}
                    label={sharing ? "Preparing media…" : "Share media"}
                  />
                </button>
                <button
                  className={MEDIA_MENU_ACTION_CLASS}
                  onClick={() =>
                    requireUser(() =>
                      close(() =>
                        useComposerStore.getState().openComposer("post", {
                          attachments: post.attachments,
                          avatarUrl: post.user?.avatarUrl ?? null,
                          content: post.content,
                          createdAt: post.createdAt,
                          displayName: post.user?.displayName ?? undefined,
                          id: post.id,
                          isGust: post.isGust,
                          username: post.user?.username ?? "unknown",
                        })
                      )
                    )
                  }
                  type="button"
                >
                  <MediaMenuActionContent
                    icon={CornerDownRight}
                    label="Respond"
                  />
                </button>
                <button
                  className={MEDIA_MENU_ACTION_CLASS}
                  onClick={() =>
                    requireUser(() =>
                      close(() => router.push(getPostPath(post)))
                    )
                  }
                  type="button"
                >
                  <MediaMenuActionContent icon={MessageSquare} label="Eddie" />
                </button>
                <BookmarkButton
                  layout="menu"
                  initialState={{
                    isBookmarkedByUser: isBookmarkedByUser(
                      post,
                      user?.id ?? ""
                    ),
                  }}
                  postId={post.id}
                />
                <button
                  className={MEDIA_MENU_ACTION_CLASS}
                  onClick={() =>
                    close(() =>
                      router.push(
                        getPostMediaPath(
                          post,
                          Math.max(
                            0,
                            post.attachments.findIndex(
                              (item) => item.id === selected.id
                            )
                          )
                        )
                      )
                    )
                  }
                  type="button"
                >
                  <MediaMenuActionContent
                    icon={Maximize2}
                    label="Open full screen"
                  />
                </button>
              </div>
            ) : (
              <MediaActionsLoading
                error={loadFailed}
                retry={() => {
                  void refetch();
                }}
              />
            )}
          </div>
        </DrawerSurface>
      </DrawerPortal>
    </Drawer>
  );
}

function MediaActionsLoading({
  error,
  retry,
}: {
  error: boolean;
  retry: () => void;
}) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm">
        <p>Couldn't load media actions.</p>
        <button
          className="btn-3d-gray rounded-full px-5 py-2"
          onClick={retry}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <output className="flex flex-col gap-1" aria-label="Loading media actions">
      {Array.from({ length: 7 }, (_, index) => (
        <div className="flex h-11 items-center gap-3 px-3" key={index}>
          <span className="bg-muted size-5 animate-pulse rounded-md" />
          <span className="bg-muted h-3 w-28 animate-pulse rounded-full" />
        </div>
      ))}
    </output>
  );
}

async function resumeVideo(player: HTMLVideoElement | null) {
  try {
    await player?.play();
  } catch {
    // Browser autoplay policy can defer playback until the next user gesture.
  }
}
