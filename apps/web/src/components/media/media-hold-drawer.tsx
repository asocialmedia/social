"use client";

import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@asm/ui/shadui/drawer";
import {
  CornerDownRight,
  Download,
  Maximize2,
  MessageSquare,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import ShareButton from "@/components/home/feedview/share-button";
import UserAvatar from "@/components/layouts/user/user-avatar";
import AuraVoteButton from "@/components/posts/actions/aura-vote-button";
import BookmarkButton from "@/components/posts/actions/bookmark-button";
import PostLinkedContent from "@/components/posts/content/post-linked-content";
import { useToast } from "@/lib/gooey-toast";
import kyInstance from "@/lib/ky";
import { setPopupOpen } from "@/lib/popup-tracker";
import { isBookmarkedByUser } from "@/lib/posts/post-normalize";
import { getPostMediaPath, getPostPath } from "@/lib/seo/seo";
import type { Media } from "@/lib/types";
import { getMediaProxyUrl, getMediaVideoUrl } from "@/lib/utils/image-url";
import { useComposerStore } from "@/store/composer-store";

export function MediaHoldDrawer({
  children,
  enabled = true,
  media,
  post,
}: {
  children: ReactNode;
  enabled?: boolean;
  media: (Media & {
    post?: { explicitContent: boolean; moderated: boolean; id: string } | null;
  })[];
  post?: PostData;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const [loadedPost, setLoadedPost] = useState<PostData | null>(null);
  const sourcePost = post ?? loadedPost;
  const [index, setIndex] = useState<number | null>(null);
  const hold = useRef<{
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  const clearHold = useCallback(() => {
    if (hold.current) {
      clearTimeout(hold.current.timer);
    }
    hold.current = null;
  }, []);
  useEffect(() => clearHold, [clearHold]);
  useEffect(() => {
    if (index === null) {
      return;
    }
    setPopupOpen(true);
    return () => setPopupOpen(false);
  }, [index]);
  const selected = index === null ? null : media[index];
  return (
    <div
      onPointerDownCapture={(event) => {
        if (
          !enabled ||
          (!post && !media.some((item) => item.post)) ||
          event.button !== 0 ||
          !matchMedia("(max-width: 768px)").matches ||
          !(event.target instanceof Element)
        ) {
          return;
        }
        if (event.target.closest('[role="dialog"]')) {
          return;
        }
        const image =
          event.target.closest("img,video") ??
          event.target
            .closest("button,[role=button]")
            ?.querySelector("img,video");
        const source =
          image?.getAttribute("src") ??
          image?.querySelector("source")?.getAttribute("src") ??
          "";
        const selectedIndex = media.findIndex((item) =>
          source.includes(item.id)
        );
        if (selectedIndex === -1 || media[selectedIndex].type === "AUDIO") {
          return;
        }
        clearHold();
        const sourceOwner = media[selectedIndex].post;
        if (sourceOwner?.explicitContent || sourceOwner?.moderated) {
          return;
        }
        const { clientX: x, clientY: y } = event;
        hold.current = {
          timer: setTimeout(() => {
            suppressClickUntil.current = Date.now() + 1000;
            if (post) {
              setIndex(selectedIndex);
            } else if (sourceOwner) {
              void (async () => {
                try {
                  const result = await kyInstance
                    .get(`/api/posts/${sourceOwner.id}`)
                    .json<{ post: PostData }>();
                  setLoadedPost(result.post);
                  setIndex(selectedIndex);
                } catch {
                  toast({
                    description: "Try opening the post.",
                    title: "Couldn't load media preview",
                  });
                }
              })();
            }
            hold.current = null;
            navigator.vibrate?.(12);
          }, 350),
          x,
          y,
        };
      }}
      onPointerMoveCapture={(event) => {
        const pending = hold.current;
        if (
          pending &&
          Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10
        ) {
          clearHold();
        }
      }}
      onPointerUpCapture={clearHold}
      onPointerCancelCapture={clearHold}
      onContextMenu={(event) => {
        if (hold.current || Date.now() < suppressClickUntil.current) {
          event.preventDefault();
        }
      }}
      onClickCapture={(event) => {
        if (
          Date.now() < suppressClickUntil.current &&
          !(
            event.target instanceof Element &&
            event.target.closest('[role="dialog"]')
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
      {selected && sourcePost ? (
        <Drawer
          open
          onOpenChange={(open) => {
            if (!open) {
              setIndex(null);
            }
          }}
          shouldScaleBackground={false}
        >
          <DrawerContent
            className="max-h-[92dvh]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="hide-native-scrollbar overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <DrawerTitle>Media preview</DrawerTitle>
                  <DrawerDescription>
                    Hold a photo or video to preview it and open its post.
                  </DrawerDescription>
                </div>
                <Button
                  aria-label="Close media preview"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIndex(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="relative flex min-h-32 items-center justify-center overflow-hidden rounded-2xl bg-black">
                {selected.type === "VIDEO" ? (
                  <video
                    aria-label="Preview video"
                    className="max-h-[45dvh] w-full object-contain"
                    controls
                    playsInline
                    autoPlay
                    src={getMediaVideoUrl(selected.id)}
                  >
                    <track
                      kind="captions"
                      src={`/api/media/${selected.id}?captions=1`}
                      srcLang="en"
                      label="Captions"
                    />
                  </video>
                ) : (
                  <Image
                    alt={selected.altText || "Media preview"}
                    className="max-h-[45dvh] w-auto max-w-full object-contain"
                    src={getMediaProxyUrl(selected)}
                    width={selected.width || 640}
                    height={selected.height || 640}
                    unoptimized
                  />
                )}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <UserAvatar size={36} user={sourcePost.user} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {sourcePost.user?.displayName || sourcePost.user?.username}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    @{sourcePost.user?.username}
                  </p>
                </div>
              </div>
              {sourcePost.content ? (
                <div className="mt-2 line-clamp-3 text-sm">
                  <PostLinkedContent content={sourcePost.content} />
                </div>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-2">
                <AuraVoteButton
                  authorName={
                    sourcePost.user?.displayName ||
                    sourcePost.user?.username ||
                    "Author"
                  }
                  initialState={{
                    aura: sourcePost.aura ?? 0,
                    userVote: sourcePost.vote?.[0]?.value ?? 0,
                  }}
                  postId={sourcePost.id}
                />
                <BookmarkButton
                  initialState={{
                    isBookmarkedByUser: isBookmarkedByUser(
                      sourcePost,
                      user?.id ?? ""
                    ),
                  }}
                  postId={sourcePost.id}
                />
                <ShareButton
                  defaultTab="link"
                  postId={sourcePost.id}
                  description={sourcePost.content}
                  dialogTitle="Share Post"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  asChild
                  variant="ghost"
                  className="btn-3d-gray rounded-xl!"
                >
                  <Link
                    href={getPostMediaPath(
                      sourcePost,
                      Math.max(
                        0,
                        sourcePost.attachments.findIndex(
                          (item) => item.id === selected.id
                        )
                      )
                    )}
                    onClick={() => setIndex(null)}
                  >
                    <Maximize2 className="size-4" />
                    Open fullscreen
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="btn-3d-gray rounded-xl!"
                >
                  <a href={`/api/media/download/${selected.id}`} download>
                    <Download className="size-4" />
                    Save media
                  </a>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="btn-3d-gray rounded-xl!"
                >
                  <Link
                    href={getPostPath(sourcePost)}
                    onClick={() => setIndex(null)}
                  >
                    <MessageSquare className="size-4" />
                    Eddies
                  </Link>
                </Button>
                <Button
                  variant="premium"
                  onClick={() => {
                    setIndex(null);
                    useComposerStore.getState().openComposer("post", {
                      attachments: sourcePost.attachments,
                      avatarUrl: sourcePost.user?.avatarUrl ?? null,
                      content: sourcePost.content,
                      createdAt: sourcePost.createdAt,
                      displayName: sourcePost.user?.displayName ?? undefined,
                      id: sourcePost.id,
                      isGust: sourcePost.isGust,
                      username: sourcePost.user?.username ?? "unknown",
                    });
                  }}
                >
                  <CornerDownRight className="size-4" />
                  Respond
                </Button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </div>
  );
}
