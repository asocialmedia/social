"use client";
// oxlint-disable react/todo -- The compiler lint does not yet support guarded async upload and cursor fetch handlers with cleanup.

import { isStickerSupportedMimeType, maxStickerInputBytes } from "@asm/media";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import addStickerArtwork from "@assets/general/zeph-add-sticker.webp";
import { Star } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import { toast } from "@/lib/gooey-toast";
import { uploadMediaFile } from "@/lib/media/media-upload-client";
import type { MessagePayload } from "@/lib/messages/crypto";
import { cn } from "@/lib/utils";

const stickerItemSchema = z.object({
  animated: z.boolean(),
  byteSize: z.number().int().nonnegative(),
  favorite: z.boolean(),
  height: z.number().int().positive().max(512),
  id: z.string(),
  mediaId: z.string(),
  name: z.string(),
  thumbnailUrl: z.string(),
  url: z.string(),
  width: z.number().int().positive().max(512),
});

const deliverySchema = z.object({
  animated: z.boolean(),
  height: z.number().int().positive().max(512),
  kind: z.enum(["gif", "image"]),
  mediaId: z.string(),
  url: z.string(),
  width: z.number().int().positive().max(512),
});

type StickerItem = z.infer<typeof stickerItemSchema>;
type StickerCollection = "mine" | "recent" | "favorites";

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const { error } = value;
    if (typeof error === "string") {
      return error;
    }
  }
  return fallback;
}

export function StickerPicker({
  active = true,
  canCreate,
  conversationId,
  disabled,
  incognitoSessionId,
  onSend,
  onSelectSticker,
  replyTarget,
}: {
  active?: boolean;
  canCreate: boolean;
  conversationId: string;
  disabled: boolean;
  incognitoSessionId?: string;
  onSend: (payload: MessagePayload) => Promise<boolean>;
  onSelectSticker?: (
    stickerId: string,
    operationId: string
  ) => Promise<boolean>;
  replyTarget: { id: string; senderId: string } | null;
}) {
  const [collection, setCollection] = useState<StickerCollection>("mine");
  const [items, setItems] = useState<StickerItem[]>([]);
  const [loadedCollection, setLoadedCollection] =
    useState<StickerCollection | null>(null);
  const loading = loadedCollection !== collection;
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState(0);
  const [createStage, setCreateStage] = useState<string | null>(null);
  const [pendingSource, setPendingSource] = useState<{
    mediaId: string;
    name: string;
  } | null>(null);
  const [stickerName, setStickerName] = useState("");
  const [sendingStickerId, setSendingStickerId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const operationIdsRef = useRef(new Map<string, string>());

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageCache = useRef(
    new Map<
      StickerCollection,
      { items: StickerItem[]; nextCursor: string | null }
    >()
  );
  useEffect(() => {
    const refresh = () => {
      pageCache.current.clear();
      setLoadedCollection(null);
    };
    window.addEventListener("sticker-library-updated", refresh);
    return () => window.removeEventListener("sticker-library-updated", refresh);
  }, []);

  useEffect(() => {
    if (loadedCollection === collection) {
      return;
    }
    const cached = pageCache.current.get(collection);
    if (cached) {
      setItems(cached.items);
      setNextCursor(cached.nextCursor);
      setLoadedCollection(collection);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/stickers?collection=${collection}&limit=40`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error("Your stickers could not be loaded");
        }
        const body: unknown = await response.json();
        const result = z
          .object({
            items: z.array(stickerItemSchema),
            nextCursor: z.string().nullable(),
          })
          .safeParse(body);
        if (!result.success) {
          throw new Error("Your stickers could not be loaded");
        }
        pageCache.current.set(collection, result.data);
        setItems(result.data.items);
        setNextCursor(result.data.nextCursor);
      } catch (error) {
        if (!controller.signal.aborted) {
          toast({
            description:
              error instanceof Error ? error.message : "Please try again.",
            title: "Stickers unavailable",
            variant: "destructive",
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadedCollection(collection);
        }
      }
    })();
    return () => controller.abort();
  }, [collection, loadedCollection]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!active || loading || !nextCursor || !root || !sentinel) {
      return;
    }
    const controller = new AbortController();
    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (requested || !entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        requested = true;
        setLoadingMore(true);
        void (async () => {
          try {
            const response = await fetch(
              `/api/stickers?collection=${collection}&limit=40&cursor=${encodeURIComponent(nextCursor)}`,
              { cache: "no-store", signal: controller.signal }
            );
            if (!response.ok) {
              throw new Error("More stickers could not be loaded");
            }
            const page = z
              .object({
                items: z.array(stickerItemSchema),
                nextCursor: z.string().nullable(),
              })
              .parse(await response.json());
            if (controller.signal.aborted) {
              return;
            }
            setItems((current) => {
              const ids = new Set(current.map((item) => item.id));
              const merged = [
                ...current,
                ...page.items.filter((item) => !ids.has(item.id)),
              ];
              pageCache.current.set(collection, {
                items: merged,
                nextCursor: page.nextCursor,
              });
              return merged;
            });
            setNextCursor(
              page.nextCursor === nextCursor ? null : page.nextCursor
            );
          } catch (error) {
            if (!controller.signal.aborted) {
              toast({
                description:
                  error instanceof Error ? error.message : "Please try again.",
                title: "More stickers unavailable",
                variant: "destructive",
              });
            }
          } finally {
            if (!controller.signal.aborted) {
              setLoadingMore(false);
            }
          }
        })();
      },
      { root, rootMargin: "0px 0px 240px 0px" }
    );
    observer.observe(sentinel);
    return () => {
      controller.abort();
      observer.disconnect();
    };
  }, [active, collection, loading, nextCursor]);

  useEffect(() => {
    if (!loading) {
      pageCache.current.set(collection, { items, nextCursor });
    }
  }, [collection, items, loading, nextCursor]);

  const handleCreateFile = async (file: File | undefined) => {
    if (!file || creating) {
      return;
    }
    if (!isStickerSupportedMimeType(file.type)) {
      toast({
        description: "Choose a JPEG, PNG, WebP, or GIF image.",
        title: "Unsupported sticker file",
        variant: "destructive",
      });
      return;
    }
    if (file.size > maxStickerInputBytes(file.type)) {
      toast({
        description:
          file.type === "image/gif"
            ? "GIFs can be up to 10 MiB."
            : "Images can be up to 5 MiB.",
        title: "Sticker file is too large",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    setCreateProgress(0);
    setCreateStage("Uploading");
    try {
      const upload = await uploadMediaFile(file, {
        onProgress: setCreateProgress,
        onStage: (stage) => setCreateStage(stage),
        purpose: "sticker",
        waitForProcessing: true,
      });
      if (upload.status !== "READY") {
        throw new Error("Sticker processing did not finish");
      }
      setPendingSource({
        mediaId: upload.mediaId,
        name: file.name.replace(/\.[^.]+$/u, "").slice(0, 64),
      });
      setStickerName(file.name.replace(/\.[^.]+$/u, "").slice(0, 64));
      setCreateStage("Ready to save");
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Please try a different file.",
        title: "Sticker creation failed",
        variant: "destructive",
      });
      setCreateStage(null);
    } finally {
      setCreating(false);
      setCreateProgress(0);
    }
  };

  const saveSticker = async () => {
    if (!pendingSource || creating) {
      return;
    }
    setCreating(true);
    setCreateStage("Saving to My stickers");
    try {
      const response = await fetch("/api/stickers", {
        body: JSON.stringify({
          mediaId: pendingSource.mediaId,
          name: stickerName,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(body, "Sticker could not be saved"));
      }
      const result = z.object({ item: stickerItemSchema }).safeParse(body);
      if (!result.success) {
        throw new Error("Sticker could not be saved");
      }
      setItems((current) => [
        result.data.item,
        ...current.filter((item) => item.id !== result.data.item.id),
      ]);
      pageCache.current.clear();
      setCollection("mine");
      setPendingSource(null);
      setStickerName("");
      setCreateStage(null);
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Please try again.",
        title: "Sticker wasn't saved",
        variant: "destructive",
      });
      setCreateStage(null);
    } finally {
      setCreating(false);
    }
  };

  const sendSticker = async (sticker: StickerItem) => {
    if (disabled || sendingStickerId) {
      return;
    }
    setSendingStickerId(sticker.id);
    const operationId =
      operationIdsRef.current.get(sticker.id) ?? crypto.randomUUID();
    operationIdsRef.current.set(sticker.id, operationId);
    try {
      if (onSelectSticker) {
        if (await onSelectSticker(sticker.id, operationId)) {
          operationIdsRef.current.delete(sticker.id);
        }
        return;
      }
      const response = await fetch(
        `/api/messages/conversations/${encodeURIComponent(conversationId)}/sticker-deliveries`,
        {
          body: JSON.stringify({
            ...(incognitoSessionId ? { incognitoSessionId } : {}),
            operationId,
            stickerId: sticker.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(body, "Sticker could not be prepared"));
      }
      const parsed = deliverySchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("Sticker could not be prepared");
      }
      const delivery = parsed.data;
      const payload: MessagePayload = {
        height: delivery.height,
        kind: delivery.kind,
        presentation: "sticker",
        replyToId: replyTarget?.id,
        replyToSenderId: replyTarget?.senderId,
        sticker: {
          animated: delivery.animated,
          mediaId: delivery.mediaId,
          version: 1,
        },
        type: "media",
        url: delivery.url,
        width: delivery.width,
      };
      if (await onSend(payload)) {
        pageCache.current.delete("recent");
        operationIdsRef.current.delete(sticker.id);
      }
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Please try again.",
        title: "Sticker wasn't sent",
        variant: "destructive",
      });
    } finally {
      setSendingStickerId(null);
    }
  };

  const addStickerTile = canCreate ? (
    <button
      aria-label="Add sticker"
      className="group/add hover:bg-muted/30 text-muted-foreground focus-visible:ring-primary flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-xl p-1.5 transition-colors focus-visible:ring-2 disabled:opacity-50"
      disabled={disabled || creating}
      onClick={() => fileInputRef.current?.click()}
      type="button"
    >
      <Image
        alt=""
        aria-hidden
        className="min-h-0 w-full flex-1 object-contain opacity-75 transition-opacity group-hover/add:opacity-100"
        src={addStickerArtwork}
        width={96}
        height={96}
      />
      <span className="shrink-0 text-[11px] leading-none font-medium">
        Add sticker
      </span>
    </button>
  ) : null;

  let stickerStatus: ReactNode = null;
  if (loading) {
    stickerStatus = (
      <div
        aria-live="polite"
        className="text-muted-foreground flex flex-col items-center py-4 text-center text-xs"
      >
        <ZephLoader variant="media" className="mb-2 size-12" />
        <p>Loading stickers…</p>
      </div>
    );
  }
  if (!loading && items.length === 0) {
    stickerStatus = (
      <p className="text-muted-foreground mt-3 text-xs">
        {collection === "mine"
          ? "Make your first sticker from an image or GIF."
          : "No stickers in this collection yet."}
      </p>
    );
  }
  const stickerContent =
    !canCreate && !loading && items.length === 0 ? (
      <div className="text-muted-foreground py-8 text-center text-sm">
        No stickers here yet
      </div>
    ) : (
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        ref={scrollRef}
        aria-label="Sticker collection"
      >
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {addStickerTile}
          {(loading ? [] : items).map((sticker) => (
            <div className="group relative min-w-0" key={sticker.id}>
              <button
                aria-label={
                  sticker.name ? `Send sticker ${sticker.name}` : "Send sticker"
                }
                className="hover:bg-muted/60 focus-visible:ring-primary flex aspect-square w-full items-center justify-center rounded-xl p-2 transition-colors focus-visible:ring-2 disabled:opacity-50"
                disabled={disabled || sendingStickerId !== null}
                onClick={() => sendSticker(sticker)}
                type="button"
              >
                <Image
                  alt=""
                  className="max-h-full max-w-full object-contain"
                  height={128}
                  loading="lazy"
                  decoding="async"
                  src={sticker.thumbnailUrl}
                  unoptimized
                  width={128}
                />
              </button>
              {sticker.favorite ? (
                <Star
                  aria-label="Favorite sticker"
                  className="text-primary fill-primary pointer-events-none absolute bottom-1 left-1 size-4"
                />
              ) : null}

              {sendingStickerId === sticker.id ? (
                <span className="text-muted-foreground bg-background/90 absolute inset-x-0 bottom-0 rounded-b-xl px-1 py-0.5 text-center text-[10px]">
                  Sending…
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {stickerStatus}
        {!loading && nextCursor ? (
          <div
            ref={sentinelRef}
            className="text-muted-foreground h-6 text-center text-xs"
            aria-live="polite"
          >
            {loadingMore ? (
              <ZephLoader
                variant="media"
                label="Loading more stickers"
                className="size-5"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["mine", "recent", "favorites"] as const).map((value) => (
          <button
            aria-pressed={collection === value}
            className={cn(
              "chip-3d rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              collection === value
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={value}
            onClick={() => setCollection(value)}
            type="button"
          >
            {value === "mine" ? "My stickers" : value}
          </button>
        ))}
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            handleCreateFile(file);
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>

      {createStage || pendingSource ? (
        <div className="surface-3d flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm">
          <span className="min-w-0 flex-1">
            {createStage ?? "Ready to save"}
          </span>
          {creating && createProgress > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              {createProgress}%
            </span>
          ) : null}
          {pendingSource ? (
            <>
              <Input
                aria-label="Sticker name"
                className="h-9 w-40"
                maxLength={64}
                onChange={(event) => setStickerName(event.target.value)}
                placeholder="Sticker name"
                value={stickerName}
              />
              <Button disabled={creating} onClick={saveSticker} size="sm">
                Save sticker
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {stickerContent}
      {incognitoSessionId && canCreate ? (
        <p className="text-muted-foreground text-xs">
          Sticker creation is unavailable in incognito chats.
        </p>
      ) : null}
    </div>
  );
}
