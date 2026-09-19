"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
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
          preload
          sizes="100vw"
          src={src}
          unoptimized
        />
      )}
    </>
  );
}

// One filmstrip thumbnail. Fixed-size and absolutely positioned so the strip
// can slide by translating its track (GPU-composited), never by layout.
function Thumb({
  active,
  item,
  onClick,
  position,
  style,
  total,
}: {
  active: boolean;
  item: ConversationMediaItem;
  onClick: () => void;
  position: number;
  style: React.CSSProperties;
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
        "absolute top-0 overflow-hidden rounded-md bg-zinc-900 transition-[opacity,box-shadow] duration-200",
        active
          ? "z-10 opacity-100 ring-2 ring-white"
          : "opacity-60 hover:opacity-100 focus-visible:opacity-100"
      )}
      onClick={onClick}
      style={{ ...style, height: THUMB_SIZE, left: 0, width: THUMB_SIZE }}
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

// Only this many tiles beyond the viewport are mounted each side. Because the
// track is centered on the active tile, items dropped at the edges are always
// off-screen, so windowing is invisible.
const STRIP_OVERSCAN = 4;

// Centered, transform-driven filmstrip. The active thumbnail is always exactly
// in the middle; changing it slides the track with a single compositor-only
// transform instead of native scrolling or per-tile layout. Only the tiles near
// the active index are mounted, so a conversation with thousands of images
// still renders a couple dozen DOM nodes.
function Filmstrip({
  activeIndex,
  items,
  onSelect,
}: {
  activeIndex: number;
  items: ConversationMediaItem[];
  onSelect: (flatKey: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Transitions stay off until after the first measured frame, so opening the
  // viewer reveals the strip already centered instead of sliding in from the
  // left. Enabled on the next frame, then every navigation animates.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (width <= 0 || animate) {
      return;
    }
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [animate, width]);

  const count = items.length;
  const center = width / 2;
  // Offset that puts the active tile's midpoint at the container's midpoint.
  const trackX =
    width > 0 ? center - (activeIndex * THUMB_STRIDE + THUMB_SIZE / 2) : 0;

  const visibleCount =
    width > 0 ? Math.ceil(width / THUMB_STRIDE) + STRIP_OVERSCAN * 2 : 0;
  const half = Math.floor(visibleCount / 2);
  const start = Math.max(0, activeIndex - half);
  const end = Math.min(count - 1, activeIndex + half);
  const windowItems: { index: number; item: ConversationMediaItem }[] = [];
  for (let index = start; index <= end; index += 1) {
    const item = items[index];
    if (item) {
      windowItems.push({ index, item });
    }
  }

  return (
    <div
      className="relative min-w-0 flex-1 overflow-hidden"
      ref={containerRef}
      style={{
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
        height: THUMB_SIZE,
        // Feather the strip edges; a plain string keeps it out of the class
        // pipeline where `calc`/comma parsing is fragile.
        maskImage:
          "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
      }}
    >
      <div
        className="absolute top-0 left-0 h-full will-change-transform"
        style={{
          transform: `translate3d(${trackX}px, 0, 0)`,
          transition: animate
            ? "transform 320ms cubic-bezier(0.22, 0.61, 0.36, 1)"
            : "none",
        }}
      >
        {windowItems.map(({ index, item }) => (
          <Thumb
            active={index === activeIndex}
            item={item}
            key={item.flatKey}
            onClick={() => onSelect(item.flatKey)}
            position={index + 1}
            style={{
              transform: `translate3d(${index * THUMB_STRIDE}px, 0, 0)`,
            }}
            total={count}
          />
        ))}
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
  onPosition: (activeIndex: number, total: number) => void;
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
  onPosition,
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
  // A stale extension must not resurface its spinner if the list later shrinks
  // back to the count it was recorded at. Drop it whenever the length changes
  // (React's derive-state-during-render pattern; no effect needed).
  const [extensionLength, setExtensionLength] = useState(items.length);
  if (extensionLength !== items.length) {
    setExtensionLength(items.length);
    setExtension(null);
  }
  const extending =
    extension && extension.count === items.length ? extension.direction : null;
  const preloadedRef = useRef(new Set<string>());
  // Set once reaching the oldest known image so a page that turns out to
  // contain no media cannot chain-load older history; reset on leaving the
  // boundary so a later visit can request again.
  const boundaryRequestedRef = useRef(false);

  // Fail-safe: if a boundary extension discovers no further media, clear the
  // spinner after a beat so an arrow can never spin forever.
  useEffect(() => {
    if (!extension) {
      return;
    }
    const timer = setTimeout(() => {
      setExtension((current) => (current === extension ? null : current));
    }, 4000);
    return () => clearTimeout(timer);
  }, [extension]);

  // Re-resolve the numeric position from the key every render: discovering
  // older media prepends items, and keying by flatKey keeps the current image
  // put instead of shifting out from under the user.
  const activeIndex = indexByKey.get(activeKey) ?? -1;
  const item = activeIndex >= 0 ? items[activeIndex] : undefined;

  // Report the current position to the thread so it can bound loaded history
  // without the viewer needing to know about React Query pages.
  useEffect(() => {
    onPosition(activeIndex, items.length);
  }, [activeIndex, items.length, onPosition]);

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
      // An unresolved anchor (payload evicted between open and first render)
      // must not let "+1" teleport to the first image.
      if (activeIndex < 0) {
        return;
      }
      const target = items[activeIndex + delta];
      if (target) {
        selectKey(target.flatKey);
        return;
      }
      // Ran out of known media in this direction: ask for more transcript to be
      // decrypted, and show a spinner until the list changes.
      const direction: MediaNavDirection = delta > 0 ? "newer" : "older";
      setExtension({ count: items.length, direction });
      if (direction === "older") {
        onLoadOlder();
      }
      onActive(activeKey, direction);
    },
    [activeIndex, activeKey, items, onActive, onLoadOlder, selectKey]
  );

  // Reaching the oldest known image pulls one more page of history so the strip
  // keeps extending as the user walks back through the conversation.
  useEffect(() => {
    if (activeIndex !== 0) {
      boundaryRequestedRef.current = false;
      return;
    }
    if (!hasOlder || isFetchingOlder || boundaryRequestedRef.current) {
      return;
    }
    boundaryRequestedRef.current = true;
    onLoadOlder();
  }, [activeIndex, hasOlder, isFetchingOlder, onLoadOlder]);

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
              aria-hidden
              className="pointer-events-none absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white backdrop-blur-md"
            >
              {activeIndex + 1} / {items.length}
            </span>
          </>
        ) : null}

        {/* Single polite announcement for screen readers, kept separate from
            the visible counter so it does not fire on every unrelated update. */}
        <span aria-live="polite" className="sr-only">
          {item
            ? `${item.kind === "gif" ? "GIF" : "Image"} ${activeIndex + 1} of ${items.length}`
            : ""}
        </span>

        <div className="pointer-events-auto z-40 flex items-center border-t border-white/10 bg-black/80 px-3 py-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          <Filmstrip
            activeIndex={activeIndex}
            items={items}
            onSelect={selectKey}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
