"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { ChevronLeft, ChevronRight, Download, ImageOff, X } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { toast } from "@/lib/gooey-toast";
import type { MediaImageRef, MessagePayload } from "@/lib/messages/crypto";
import { getMediaImages } from "@/lib/messages/crypto";
import { cn } from "@/lib/utils";
import {
  getMessageMediaId,
  getMessageMediaVariantUrl,
  getMessageMediaViewerUrl,
} from "@/lib/utils/image-url";

import { getAlbumLayout } from "./message-album-layout";

// Bento layouts for grouped albums live in message-album-layout.ts (pure, so
// the shapes are unit-tested). Each count from 2 to 10 has a bespoke layout;
// count 1 renders at its natural aspect ratio instead.

// Streams a media row back as a forced download. Lives at module scope because
// React Compiler cannot lower a `throw` inside a component-level try block (see
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

type LoadStatus = "error" | "loaded" | "loading";

function useMediaSource(image: MediaImageRef, kind: "gif" | "image") {
  const variant =
    kind === "image" ? getMessageMediaVariantUrl(image.url, image.width) : null;
  const [src, setSrc] = useState(variant ?? image.url);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  // One automatic fallback: optimized derivative -> original. A second failure
  // surfaces the retry affordance instead of an invisible box.
  const handleError = useCallback(() => {
    if (src !== image.url) {
      setSrc(image.url);
      return;
    }
    setStatus("error");
  }, [image.url, src]);

  const handleLoad = useCallback(() => {
    setStatus("loaded");
  }, []);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  return { attempt, handleError, handleLoad, retry, src, status };
}

// One bento cell. `object-cover` fills the assigned rectangle so mixed
// orientations tile cleanly; the uncropped image is available in the viewer.
function AlbumTile({
  image,
  index,
  kind,
  onClick,
  style,
  total,
}: {
  image: MediaImageRef;
  index: number;
  kind: "gif" | "image";
  onClick: () => void;
  style: React.CSSProperties;
  total: number;
}) {
  const { attempt, handleError, handleLoad, retry, src, status } =
    useMediaSource(image, kind);

  // The tile is a plain container: the image and Retry are non-interactive, and
  // a dedicated overlay button opens the viewer. Nesting a Retry button inside
  // an outer open button would be invalid HTML (and unreachable for a11y tools).
  return (
    <div
      className="relative min-h-0 min-w-0 overflow-hidden bg-black/15"
      style={style}
    >
      {status === "loading" ? (
        <span className="bg-muted/60 absolute inset-0 animate-pulse" />
      ) : null}

      {status === "error" ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/20 px-1 text-center">
          <ImageOff className="text-muted-foreground h-4 w-4" />
          <button
            className="text-muted-foreground text-[10px] font-medium hover:underline"
            onClick={retry}
            type="button"
          >
            Retry
          </button>
        </span>
      ) : (
        <Image
          alt={kind === "gif" ? "GIF" : "Shared image"}
          className={cn(
            "object-cover transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0"
          )}
          fill
          key={attempt}
          onError={handleError}
          onLoad={handleLoad}
          sizes="(max-width: 640px) 80vw, 384px"
          src={src}
          // Session-gated media can't be fetched by the server-side Image
          // optimizer (no viewer cookies), so sources are pre-sized pipeline
          // derivatives instead.
          unoptimized
        />
      )}

      {status === "error" ? null : (
        <button
          aria-label={`Open image ${index + 1} of ${total}`}
          className="absolute inset-0 z-10 outline-hidden focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-inset"
          onClick={onClick}
          type="button"
        />
      )}
    </div>
  );
}

// Bento collage for a grouped album. The grid's aspect ratio equals its
// column/row count, so every base cell is square and each tile is an exact
// rectangle of cells (see ALBUM_LAYOUTS). Senders can attach up to 10 images,
// and every count from 2 to 10 has a bespoke layout.
function AlbumGrid({
  images,
  kind,
  onOpen,
}: {
  images: MediaImageRef[];
  kind: "gif" | "image";
  onOpen: (index: number) => void;
}) {
  const count = images.length;
  if (count === 1) {
    return (
      <SingleImage image={images[0]} kind={kind} onClick={() => onOpen(0)} />
    );
  }

  const layout = getAlbumLayout(count);
  const visible = images.slice(0, layout.placements.length);

  return (
    <div
      className="grid w-[min(24rem,80vw,100%)] gap-1 overflow-hidden rounded-2xl"
      style={{
        aspectRatio: `${layout.cols} / ${layout.rows}`,
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {visible.map((image, index) => {
        const placement = layout.placements[index];
        return (
          <AlbumTile
            image={image}
            index={index}
            key={`${index}-${image.url}`}
            kind={kind}
            onClick={() => onOpen(index)}
            style={{
              gridColumn: `${placement.col + 1} / span ${placement.colSpan}`,
              gridRow: `${placement.row + 1} / span ${placement.rowSpan}`,
            }}
            total={count}
          />
        );
      })}
    </div>
  );
}

// Single image keeps the original aspect-ratio box (object-contain) so nothing
// is cropped when a message has just one attachment.
function SingleImage({
  image,
  kind,
  onClick,
}: {
  image: MediaImageRef;
  kind: "gif" | "image";
  onClick: () => void;
}) {
  const { attempt, handleError, handleLoad, retry, src, status } =
    useMediaSource(image, kind);
  const aspectRatio =
    image.width && image.height ? `${image.width} / ${image.height}` : "4 / 3";

  return (
    <div
      className="relative w-[min(24rem,80vw,100%)] overflow-hidden rounded-2xl bg-black/15 text-left"
      style={{ aspectRatio }}
    >
      {status === "loading" ? (
        <span className="bg-muted/60 absolute inset-0 animate-pulse" />
      ) : null}
      {status === "error" ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
          <ImageOff className="text-muted-foreground h-5 w-5" />
          <span className="text-muted-foreground text-xs">
            Couldn&apos;t load image
          </span>
          <button
            className="text-primary text-xs font-medium hover:underline"
            onClick={retry}
            type="button"
          >
            Retry
          </button>
        </span>
      ) : (
        <Image
          alt={kind === "gif" ? "GIF" : "Shared image"}
          className={cn(
            "object-contain transition-opacity duration-200",
            status === "loaded" ? "opacity-100" : "opacity-0"
          )}
          fill
          key={attempt}
          onError={handleError}
          onLoad={handleLoad}
          sizes="(max-width: 640px) 80vw, 384px"
          src={src}
          unoptimized
        />
      )}
      {status === "error" ? null : (
        <button
          aria-label={kind === "gif" ? "Open GIF" : "Open image"}
          className="absolute inset-0 z-10 rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={onClick}
          type="button"
        />
      )}
    </div>
  );
}

// Fullscreen album viewer. Deliberately lighter than the feed's MediaViewer:
// message attachments carry no post/derivative metadata, so this only needs
// prev/next, download, and keyboard navigation.
function MessageMediaViewer({
  images,
  initialIndex,
  kind,
  onClose,
}: {
  images: MediaImageRef[];
  initialIndex: number;
  kind: "gif" | "image";
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const current = images[index];
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [downloading, setDownloading] = useState(false);

  const goPrevious = useCallback(() => {
    setIndex((value) => (value > 0 ? value - 1 : images.length - 1));
    setStatus("loading");
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((value) => (value < images.length - 1 ? value + 1 : 0));
    setStatus("loading");
  }, [images.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrevious]);

  const handleDownload = useCallback(async () => {
    if (!current || downloading) {
      return;
    }
    const mediaId = getMessageMediaId(current.url);
    if (!mediaId) {
      toast({ title: "Download Failed", variant: "destructive" });
      return;
    }
    setDownloading(true);
    try {
      await downloadMediaById(mediaId);
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
  }, [current, downloading]);

  if (!current) {
    return null;
  }

  const viewerSrc = getMessageMediaViewerUrl(current.url, kind);

  return (
    <Dialog onOpenChange={onClose} open>
      <DialogContent
        className="flex h-[100dvh] max-h-none w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 [&>button:last-child]:hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <VisuallyHidden>
          <DialogTitle>Shared image</DialogTitle>
          <DialogDescription>
            {kind === "gif" ? "Shared GIF" : "Shared image"} {index + 1} of{" "}
            {images.length}
          </DialogDescription>
        </VisuallyHidden>

        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {status === "loading" ? (
            <span className="absolute inset-0 animate-pulse bg-white/5" />
          ) : null}
          <Image
            alt={`Image ${index + 1} of ${images.length}`}
            className={cn(
              "object-contain transition-opacity duration-200",
              status === "loaded" ? "opacity-100" : "opacity-0"
            )}
            fill
            key={`${current.url}-${index}`}
            onError={() => setStatus("error")}
            onLoad={() => setStatus("loaded")}
            priority
            sizes="100vw"
            src={viewerSrc}
            unoptimized
          />
          {status === "error" ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm text-white/80">
                Couldn&apos;t load this image.
              </span>
            </span>
          ) : null}
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
          disabled={downloading}
          onClick={() => {
            void handleDownload();
          }}
          type="button"
        >
          <Download className="h-5 w-5" />
        </button>

        {images.length > 1 ? (
          <>
            <button
              aria-label="Previous image"
              className="absolute top-1/2 left-3 z-50 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/70 active:translate-y-px"
              onClick={goPrevious}
              type="button"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              aria-label="Next image"
              className="absolute top-1/2 right-3 z-50 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white backdrop-blur-md transition-all hover:bg-black/70 active:translate-y-px"
              onClick={goNext}
              type="button"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
            <span
              aria-live="polite"
              className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white backdrop-blur-md"
            >
              {index + 1} / {images.length}
            </span>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MessageMediaAlbum({
  content,
}: {
  content: Extract<MessagePayload, { type: "media" }>;
}) {
  const images = getMediaImages(content);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const caption = content.content?.trim();

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <AlbumGrid images={images} kind={content.kind} onOpen={setViewerIndex} />
      {caption ? (
        <p className="min-w-0 px-0.5 text-sm break-words whitespace-pre-wrap">
          {caption}
        </p>
      ) : null}
      {viewerIndex === null ? null : (
        <MessageMediaViewer
          images={images}
          initialIndex={viewerIndex}
          kind={content.kind}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
