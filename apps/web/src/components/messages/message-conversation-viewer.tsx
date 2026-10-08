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
import { useConversationMediaWindow } from "./use-conversation-media";

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
// Consecutive older pages the boundary auto-loader will pull while parked on the
// oldest known image without finding any media, before it stops. Keeps an
// imageless tail from silently streaming in the whole conversation while still
// walking past a few empty pages.
const MAX_BOUNDARY_MISSES = 3;

async function tryLoadBoundaryPage(
  loadPage: () => Promise<boolean> | boolean
): Promise<boolean> {
  try {
    return await loadPage();
  } catch {
    return false;
  }
}

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
        <span className="bg-muted/50 absolute inset-0 animate-pulse" />
      ) : null}
      {status === "error" ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <ImageOff className="text-muted-foreground size-6" />
          <span className="text-muted-foreground text-sm">
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
        "bg-muted absolute top-0 overflow-hidden rounded-md transition-[opacity,box-shadow] duration-200",
        active
          ? "ring-muted-foreground z-10 opacity-100 ring-2 ring-inset"
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
  startIndex,
  total,
}: {
  activeIndex: number;
  items: ConversationMediaItem[];
  onSelect: (flatKey: string) => void;
  startIndex: number;
  total: number;
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
            position={startIndex + index + 1}
            style={{
              transform: `translate3d(${index * THUMB_STRIDE}px, 0, 0)`,
            }}
            total={total}
          />
        ))}
      </div>
    </div>
  );
}

interface ConversationMediaViewerProps {
  anchorKey: string;
  hasOlder: boolean;
  hasNewer: boolean;
  isFetchingOlder: boolean;
  isFetchingNewer: boolean;
  messages: readonly ConversationMediaMessage[];
  onActive: (flatKey: string, direction: MediaNavDirection) => void;
  onClose: () => void;
  // Loads one older or newer page. Resolves true when the loaded transcript
  // actually grew, so the boundary loader knows whether it made progress.
  onLoadOlder: () => Promise<boolean> | boolean;
  onLoadNewer: () => Promise<boolean> | boolean;
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
  hasNewer,
  isFetchingOlder,
  isFetchingNewer,
  messages,
  onActive,
  onClose,
  onLoadOlder,
  onLoadNewer,
  onPosition,
}: ConversationMediaViewerProps) {
  const [activeKey, setActiveKey] = useState(anchorKey);
  const index = useConversationMediaWindow(messages, activeKey);
  const {
    absoluteIndex,
    activeIndex,
    indexByKey,
    items,
    startIndex,
    totalItems,
  } = index;
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
  const [extensionLength, setExtensionLength] = useState(totalItems);
  if (extensionLength !== totalItems) {
    setExtensionLength(totalItems);
    setExtension(null);
  }
  const extending =
    extension && extension.count === totalItems ? extension.direction : null;
  // Insertion-ordered set of preloaded URLs (Map so the oldest can be evicted
  // first when the cap is reached).
  const preloadedRef = useRef(new Map<string, true>());
  // Consecutive pages pulled while parked at either media boundary that turned
  // out to hold no media. A few empty pages are tolerated, then automatic
  // paging stops so an imageless tail cannot stream the whole conversation.
  const boundaryMissesRef = useRef({ newer: 0, older: 0 });

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
  const item = activeIndex >= 0 ? items[activeIndex] : undefined;

  // Report the current position to the thread so it can bound loaded history
  // without the viewer needing to know about React Query pages.
  useEffect(() => {
    onPosition(absoluteIndex, totalItems);
  }, [absoluteIndex, onPosition, totalItems]);

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
      const canLoad = direction === "older" ? hasOlder : hasNewer;
      const isFetching =
        direction === "older" ? isFetchingOlder : isFetchingNewer;
      if (!canLoad || isFetching) {
        return;
      }
      setExtension({ count: totalItems, direction });
      if (direction === "older") {
        void tryLoadBoundaryPage(onLoadOlder);
      } else {
        void tryLoadBoundaryPage(onLoadNewer);
      }
      onActive(activeKey, direction);
    },
    [
      activeIndex,
      activeKey,
      hasNewer,
      hasOlder,
      isFetchingNewer,
      isFetchingOlder,
      items,
      onActive,
      onLoadNewer,
      onLoadOlder,
      selectKey,
      totalItems,
    ]
  );

  // Reaching a loaded media boundary pulls one page in that direction. Bounded:
  // after a few consecutive pages with no media the walk stops, so an imageless
  // stretch cannot silently stream in the entire conversation.
  useEffect(() => {
    const atOlderBoundary = absoluteIndex === 0;
    const atNewerBoundary =
      absoluteIndex >= 0 && absoluteIndex === totalItems - 1;
    if (!atOlderBoundary) {
      boundaryMissesRef.current.older = 0;
    }
    if (!atNewerBoundary) {
      boundaryMissesRef.current.newer = 0;
    }
    if (
      atOlderBoundary &&
      hasOlder &&
      !isFetchingOlder &&
      boundaryMissesRef.current.older < MAX_BOUNDARY_MISSES
    ) {
      boundaryMissesRef.current.older += 1;
      void tryLoadBoundaryPage(onLoadOlder);
    }
    if (
      atNewerBoundary &&
      hasNewer &&
      !isFetchingNewer &&
      boundaryMissesRef.current.newer < MAX_BOUNDARY_MISSES
    ) {
      boundaryMissesRef.current.newer += 1;
      void tryLoadBoundaryPage(onLoadNewer);
    }
  }, [
    absoluteIndex,
    hasNewer,
    hasOlder,
    isFetchingNewer,
    isFetchingOlder,
    onLoadNewer,
    onLoadOlder,
    totalItems,
  ]);

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
      // Insertion-ordered Map: evict the oldest preloaded URL instead of
      // clearing the whole set, so a long scroll does not re-fetch recent
      // neighbors it already warmed.
      if (preloadedRef.current.size >= PRELOAD_CACHE_CAP) {
        const oldest = preloadedRef.current.keys().next().value;
        if (oldest !== undefined) {
          preloadedRef.current.delete(oldest);
        }
      }
      preloadedRef.current.set(src, true);
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
      // Let interactive controls (the scrubber) own their own arrow keys.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) {
        return;
      }
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

  const hasNeighbors = items.length > 1 || hasOlder || hasNewer;
  const position = absoluteIndex + 1;

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent
        className="bg-background text-foreground flex h-[100dvh] max-h-none w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none! border-0 p-0 [&>button:last-child]:hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <VisuallyHidden>
          <DialogTitle>Conversation media</DialogTitle>
          <DialogDescription>
            {item?.kind === "gif" ? "GIF" : "Image"} {position} of {totalItems}
          </DialogDescription>
        </VisuallyHidden>

        {/* Stage: sits on the darker grey surface (the app's raised/secondary
            tone) so it reads as a distinct image container against the
            `bg-background` chrome bars above and below. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[hsl(var(--background-alt))]">
          {item ? (
            <StageImage
              item={item}
              key={item.flatKey}
              position={position}
              total={totalItems}
            />
          ) : (
            <span className="text-muted-foreground text-sm">
              This image is no longer available.
            </span>
          )}
        </div>

        <button
          aria-label="Close viewer"
          className="border-border/60 bg-background/70 text-foreground hover:bg-background/90 absolute top-3 left-3 z-50 flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-90"
          onClick={onClose}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>

        <button
          aria-label="Download image"
          className="border-border/60 bg-background/70 text-foreground hover:bg-background/90 absolute top-3 right-3 z-50 flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-90 disabled:opacity-50 disabled:hover:scale-100"
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
              className="border-border/60 bg-background/70 text-foreground hover:bg-background/90 absolute top-1/2 left-3 z-50 flex -translate-y-1/2 items-center justify-center rounded-full border p-2.5 backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-90"
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
              className="border-border/60 bg-background/70 text-foreground hover:bg-background/90 absolute top-1/2 right-3 z-50 flex -translate-y-1/2 items-center justify-center rounded-full border p-2.5 backdrop-blur-md transition-transform duration-150 hover:scale-105 active:scale-90"
              onClick={() => step(1)}
              type="button"
            >
              {extending === "newer" ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <ChevronRight className="h-6 w-6" />
              )}
            </button>
          </>
        ) : null}

        {/* Single polite announcement for screen readers, kept separate from
            the visible counter so it does not fire on every unrelated update. */}
        <span aria-live="polite" className="sr-only">
          {item
            ? `${item.kind === "gif" ? "GIF" : "Image"} ${position} of ${totalItems}`
            : ""}
        </span>

        <div className="border-border/60 bg-background/90 pointer-events-auto z-40 flex items-center gap-2 border-t px-3 py-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
          {activeIndex >= 0 ? (
            <Filmstrip
              activeIndex={activeIndex}
              items={items}
              onSelect={selectKey}
              startIndex={startIndex}
              total={totalItems}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
