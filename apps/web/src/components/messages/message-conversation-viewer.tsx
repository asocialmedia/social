"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Loader2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";
import {
  getMessageMediaVariantUrl,
  getMessageMediaViewerUrl,
} from "@/lib/utils/image-url";

import type {
  ConversationMediaItem,
  ConversationMediaMessage,
} from "./message-conversation-media";
import { useConversationMediaIndex } from "./use-conversation-media";

type LoadStatus = "error" | "loaded" | "loading";

// Direction of a boundary request: the viewer could not advance because it ran
// out of known media, so it asks the thread to decrypt more transcript in that
// direction. `null` is a plain centering request on open/selection.
export type MediaNavDirection = "newer" | "older" | null;

const THUMB_SIZE = 56;
const THUMB_GAP = 4;
const THUMB_STRIDE = THUMB_SIZE + THUMB_GAP;
// Cap on remembered preloaded URLs. Only raster neighbors are preloaded, so
// this bounds an intentionally small cache.
const PRELOAD_CACHE_CAP = 128;

// Streams a media row back as a forced download. Module scope because React
// Compiler cannot lower a `throw` inside a component-level try block (see
// media-viewer.tsx for the same constraint).
async function downloadMediaById(mediaId: string): Promise<void> {
  const response = await fetch(`/api/media/download/${mediaId}`);
  if (response.status === 429) {
    throw new Error("Too Many Downloads");
  }
  if (!response.ok) {
    throw new Error("Download failed");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = mediaId;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

// The fullscreen image, keyed by flatKey so a change of item remounts it and
// resets the load state without a sync effect.
function StageImage({
  item,
  position,
  total,
}: {
  item: ConversationMediaItem;
  position: number;
  total: number;
}) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const src = getMessageMediaViewerUrl(item.url, item.kind);

  return (
    <>
      {status === "loading" ? (
        <span className="absolute inset-0 animate-pulse bg-white/5" />
      ) : null}
      {status === "error" ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <ImageOff className="size-6 text-white/70" />
          <span className="text-sm text-white/80">
            Couldn&apos;t load this image.
          </span>
          <button
            className="rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] px-5 py-2 text-sm font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] transition-all hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px"
            onClick={() => {
              setStatus("loading");
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </span>
      ) : (
        <Image
          alt={`${item.kind === "gif" ? "GIF" : "Image"} ${position} of ${total}`}
          className={cn(
            "object-contain transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0"
          )}
          fill
          key={attempt}
          onError={() => setStatus("error")}
          onLoad={() => setStatus("loaded")}
          priority
          sizes="100vw"
          src={src}
          unoptimized
        />
      )}
    </>
  );
}

// One filmstrip thumbnail. A fixed-size button so the horizontal virtualizer
// can position it without measurement.
function Thumb({
  active,
  item,
  onClick,
  position,
  total,
}: {
  active: boolean;
  item: ConversationMediaItem;
  onClick: () => void;
  position: number;
  total: number;
}) {
  const src =
    item.kind === "gif"
      ? item.url
      : (getMessageMediaVariantUrl(item.url, item.width) ?? item.url);
  return (
    <button
      aria-current={active}
      aria-label={`Open image ${position} of ${total}`}
      className={cn(
        "absolute top-0 overflow-hidden rounded-md bg-zinc-900 transition-all",
        active
          ? "ring-2 ring-white"
          : "opacity-60 hover:opacity-100 focus-visible:opacity-100"
      )}
      onClick={onClick}
      style={{ height: THUMB_SIZE, left: 0, width: THUMB_SIZE }}
      type="button"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny session-gated thumb, no optimizer possible */}
      <img
        alt=""
        className="h-full w-full object-cover"
        decoding="async"
        loading="lazy"
        src={src}
      />
    </button>
  );
}

function Filmstrip({
  activeIndex,
  hasOlder,
  isFetchingOlder,
  items,
  onLoadOlder,
  onSelect,
  scrollRef,
}: {
  activeIndex: number;
  hasOlder: boolean;
  isFetchingOlder: boolean;
  items: ConversationMediaItem[];
  onLoadOlder: () => void;
  onSelect: (flatKey: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const offset = hasOlder ? 1 : 0;
  const count = items.length + offset;
  // oxlint-disable-next-line react/incompatible-library -- useVirtualizer returns unmemoizable measuring/scroll handles by design (upstream recipe); thumbs are keyed and memo-stable on their own props
  const virtualizer = useVirtualizer({
    count,
    estimateSize: () => THUMB_STRIDE,
    getScrollElement: () => scrollRef.current,
    horizontal: true,
    overscan: 6,
  });

  const activeVirtualIndex = activeIndex + offset;
  useEffect(() => {
    if (activeVirtualIndex >= 0 && activeVirtualIndex < count) {
      virtualizer.scrollToIndex(activeVirtualIndex, { align: "center" });
    }
  }, [activeVirtualIndex, count, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      className="flex-1 [scrollbar-width:none] overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
      ref={scrollRef}
    >
      <div
        className="relative"
        style={{ height: THUMB_SIZE, width: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const style = {
            transform: `translateX(${virtualItem.start}px)`,
          };
          if (hasOlder && virtualItem.index === 0) {
            return (
              <button
                aria-label="Load older images"
                className="absolute top-0 flex items-center justify-center rounded-md border border-white/20 bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-60"
                disabled={isFetchingOlder}
                key="load-older"
                onClick={onLoadOlder}
                style={{
                  ...style,
                  height: THUMB_SIZE,
                  left: 0,
                  width: THUMB_SIZE,
                }}
                type="button"
              >
                {isFetchingOlder ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ChevronLeft className="size-5" />
                )}
              </button>
            );
          }
          const item = items[virtualItem.index - offset];
          if (!item) {
            return null;
          }
          return (
            <Thumb
              active={virtualItem.index === activeVirtualIndex}
              item={item}
              key={item.flatKey}
              onClick={() => onSelect(item.flatKey)}
              position={virtualItem.index - offset + 1}
              total={items.length}
            />
          );
        })}
      </div>
    </div>
  );
}

interface ConversationMediaViewerProps {
  anchorKey: string;
  hasOlder: boolean;
  isFetchingOlder: boolean;
  messages: readonly ConversationMediaMessage[];
  onActive: (flatKey: string, direction: MediaNavDirection) => void;
  onClose: () => void;
  onLoadOlder: () => void;
}

// Conversation-wide fullscreen viewer. Mounts exactly one image at a time and
// navigates a stable-keyed list, so paging across message boundaries never
// reloads the current image or grows the DOM with history.
//
// It owns the media-index subscription itself: mounting only when open means a
// decrypt completion re-renders this viewer, never the transcript behind it.
export function ConversationMediaViewer({
  anchorKey,
  hasOlder,
  isFetchingOlder,
  messages,
  onActive,
  onClose,
  onLoadOlder,
}: ConversationMediaViewerProps) {
  const index = useConversationMediaIndex(messages);
  const { indexByKey, items } = index;
  const [activeKey, setActiveKey] = useState(anchorKey);
  const [downloading, setDownloading] = useState(false);
  // Direction of an in-flight boundary extension, tagged with the media count
  // at request time. Deriving `extending` from the current count means the
  // spinner clears itself the moment new media arrives, with no effect.
  const [extension, setExtension] = useState<{
    count: number;
    direction: MediaNavDirection;
  } | null>(null);
  const extending =
    extension && extension.count === items.length ? extension.direction : null;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const preloadedRef = useRef(new Set<string>());

  // Re-resolve the numeric position from the key every render: discovering
  // older media prepends items, and keying by flatKey keeps the current image
  // put instead of shifting out from under the user.
  const activeIndex = indexByKey.get(activeKey) ?? -1;
  const item = activeIndex >= 0 ? items[activeIndex] : undefined;

  const selectKey = useCallback(
    (flatKey: string) => {
      if (flatKey === activeKey) {
        return;
      }
      const nextIndex = indexByKey.get(flatKey);
      if (nextIndex === undefined) {
        return;
      }
      const currentIndex = indexByKey.get(activeKey);
      const direction: MediaNavDirection =
        currentIndex !== undefined && nextIndex < currentIndex
          ? "older"
          : "newer";
      setActiveKey(flatKey);
      onActive(flatKey, direction);
    },
    [activeKey, indexByKey, onActive]
  );

  const step = useCallback(
    (delta: number) => {
      const target = items[activeIndex + delta];
      if (target) {
        selectKey(target.flatKey);
        return;
      }
      // Ran out of known media in this direction: ask for more transcript to be
      // decrypted, and show a spinner until the list changes.
      const direction: MediaNavDirection = delta > 0 ? "newer" : "older";
      setExtension({ count: items.length, direction });
      onActive(activeKey, direction);
    },
    [activeIndex, activeKey, items, onActive, selectKey]
  );

  // Keep the decrypt window centered on wherever the viewer currently is. The
  // effect re-runs on navigation AND whenever the thread's callback identity
  // changes (page prepend, key healing), so freshly loaded history is scanned
  // for media without the viewer ever paging on its own. request() dedupes, so
  // the overlap with selectKey's explicit call is free.
  useEffect(() => {
    onActive(activeKey, null);
  }, [activeKey, onActive]);

  // Preload only the immediate raster neighbors (never GIFs - their animated
  // bytes are large and the viewer still requests them on demand).
  useEffect(() => {
    for (const neighbor of [items[activeIndex - 1], items[activeIndex + 1]]) {
      if (!neighbor || neighbor.kind === "gif") {
        continue;
      }
      const src = getMessageMediaViewerUrl(neighbor.url, neighbor.kind);
      if (preloadedRef.current.has(src)) {
        continue;
      }
      if (preloadedRef.current.size >= PRELOAD_CACHE_CAP) {
        preloadedRef.current.clear();
      }
      preloadedRef.current.add(src);
      const image = new window.Image();
      image.decoding = "async";
      image.src = src;
    }
  }, [activeIndex, items]);

  const handleDownload = useCallback(async () => {
    if (!item || downloading) {
      return;
    }
    if (!item.mediaId) {
      toast({ title: "Download Failed", variant: "destructive" });
      return;
    }
    setDownloading(true);
    try {
      await downloadMediaById(item.mediaId);
    } catch (error) {
      const tooMany =
        error instanceof Error && error.message === "Too Many Downloads";
      toast({
        description: tooMany
          ? "Slow down a bit, then try again"
          : "Couldn't download that file, try again?",
        title: tooMany ? "Too Many Downloads" : "Download Failed",
        variant: "destructive",
      });
    }
    setDownloading(false);
  }, [downloading, item]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "Home") {
        event.preventDefault();
        const [first] = items;
        if (first) {
          selectKey(first.flatKey);
        }
      } else if (event.key === "End") {
        event.preventDefault();
        const last = items.at(-1);
        if (last) {
          selectKey(last.flatKey);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, selectKey, step]);

  const hasNeighbors = items.length > 1;

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 [&>button:last-child]:hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <VisuallyHidden>
          <DialogTitle>Conversation media</DialogTitle>
          <DialogDescription>
            {item?.kind === "gif" ? "GIF" : "Image"} {activeIndex + 1} of{" "}
            {items.length}
          </DialogDescription>
        </VisuallyHidden>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {item ? (
            <StageImage
              item={item}
              key={item.flatKey}
              position={activeIndex + 1}
              total={items.length}
            />
          ) : (
            <span className="text-sm text-white/80">
              This image is no longer available.
            </span>
          )}
        </div>

        <button
          aria-label="Close viewer"
          className="absolute top-3 left-3 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/70 active:translate-y-px"
          onClick={onClose}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>

        <button
          aria-label="Download image"
          className="absolute top-3 right-3 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition-all hover:bg-black/70 active:translate-y-px disabled:opacity-50"
          disabled={downloading || !item}
          onClick={() => {
            void handleDownload();
          }}
          type="button"
        >
          <Download className="h-5 w-5" />
        </button>

        {hasNeighbors ? (
          <>
            <button
              aria-label="Previous image"
              className="absolute top-1/2 left-3 z-50 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/70 active:translate-y-px"
              onClick={() => step(-1)}
              type="button"
            >
              {extending === "older" ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <ChevronLeft className="h-6 w-6" />
              )}
            </button>
            <button
              aria-label="Next image"
              className="absolute top-1/2 right-3 z-50 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/70 active:translate-y-px"
              onClick={() => step(1)}
              type="button"
            >
              {extending === "newer" ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <ChevronRight className="h-6 w-6" />
              )}
            </button>
            <span
              aria-live="polite"
              className="pointer-events-none absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white backdrop-blur-md"
            >
              {activeIndex + 1} / {items.length}
            </span>
          </>
        ) : null}

        <div className="pointer-events-auto z-40 flex items-center gap-2 border-t border-white/10 bg-black/80 px-3 py-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          <Filmstrip
            activeIndex={activeIndex}
            hasOlder={hasOlder}
            isFetchingOlder={isFetchingOlder}
            items={items}
            onLoadOlder={onLoadOlder}
            onSelect={selectKey}
            scrollRef={stripRef}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
