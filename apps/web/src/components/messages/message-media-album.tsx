"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import type React from "react";
import { useCallback, useState } from "react";

import type { MediaImageRef, MessagePayload } from "@/lib/messages/crypto";
import { getMediaImages } from "@/lib/messages/crypto";
import { cn } from "@/lib/utils";
import { getMessageMediaVariantUrl } from "@/lib/utils/image-url";

import { getAlbumLayout } from "./message-album-layout";
import { useOpenConversationMedia } from "./message-media-viewer-context";

// Bento layouts for grouped albums live in message-album-layout.ts (pure, so
// the shapes are unit-tested). Each count from 2 to 10 has a bespoke layout;
// count 1 renders at its natural aspect ratio instead.
//
// The fullscreen experience is owned by the thread (see
// message-conversation-viewer.tsx): a tile just opens the conversation-wide
// viewer at its own image, so users can page through every image in the thread.

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
      className="grid w-96 max-w-[80vw] min-w-0 gap-1 overflow-hidden rounded-2xl"
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
      className="relative w-96 max-w-[80vw] min-w-0 overflow-hidden rounded-2xl bg-black/15 text-left"
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

export function MessageMediaAlbum({
  content,
  messageId,
}: {
  content: Extract<MessagePayload, { type: "media" }>;
  messageId: string;
}) {
  const images = getMediaImages(content);
  const openConversationMedia = useOpenConversationMedia();
  const caption = content.content?.trim();

  const handleOpen = useCallback(
    (imageIndex: number) => {
      openConversationMedia?.({ imageIndex, messageId });
    },
    [messageId, openConversationMedia]
  );

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <AlbumGrid images={images} kind={content.kind} onOpen={handleOpen} />
      {caption ? (
        <p className="min-w-0 px-0.5 text-sm break-words whitespace-pre-wrap">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
