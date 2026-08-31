"use client";

import type { Media } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import { FileIcon, Loader2, Volume2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";

import MediaViewer from "@/components/home/feedview/media-viewer";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import ModeratedNotice from "@/components/posts/moderated-notice";
import { useUserMediaQuery } from "@/hooks/use-user-media-query";
import type { UserMediaItem } from "@/hooks/use-user-media-query";
import { formatFileName } from "@/lib/format-file-name";
import { getPostMediaPath, getPostPath } from "@/lib/seo";
import { cn } from "@/lib/utils";
import {
  getMediaImageSrcSet,
  getMediaProxyUrl,
  getMediaVideoUrl,
} from "@/lib/utils/image-url";

// Full skeleton grid with the login prompt centered on top. Shared between the
// desktop locked sidebar and the mobile media tab so guests see the same look.
// Two explicit columns with alternating aspect ratios guarantee a Pinterest
// style masonry arrangement on every screen width.
export const MediaGalleryLocked: React.FC<{ bare?: boolean }> = ({
  bare = false,
}) =>
  bare ? (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 p-4 text-center">
      <Image
        alt=""
        className="h-28 w-auto object-contain"
        draggable={false}
        height={1024}
        src={noMediaImage}
        width={1536}
      />
      <p className="text-sm font-medium">Media</p>
      <p className="text-muted-foreground max-w-44 text-xs">
        Log in to see this profile's media
      </p>
      <Button
        asChild
        className="mt-1 h-8 rounded-full px-4 text-xs"
        variant="premium"
      >
        <Link href="/login">Log in</Link>
      </Button>
    </div>
  ) : (
    <div className="relative h-full">
      <MediaSkeletonGrid />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[hsl(var(--background-alt))]/75 p-4 text-center backdrop-blur-sm">
        <Image
          alt=""
          className="h-28 w-auto object-contain"
          draggable={false}
          height={1024}
          src={noMediaImage}
          width={1536}
        />
        <p className="text-sm font-medium">Media</p>
        <p className="text-muted-foreground max-w-44 text-xs">
          Log in to see this profile's media
        </p>
        <Button
          asChild
          className="mt-1 h-8 rounded-full px-4 text-xs"
          variant="premium"
        >
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    </div>
  );

// Fixed-aspect skeleton tiles (masonry style) that tile down the full height of
// the sidebar. The column height is measured and enough tiles are rendered to
// fill it, so the count scales dynamically instead of tiles stretching.
const MediaSkeletonGrid: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tilesPerColumn, setTilesPerColumn] = useState(4);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const recompute = () => {
      const height = el.clientHeight;
      // Conservative average tile height for the two-column grid so the last
      // full tile fits inside the sidebar instead of overflowing. Overshoot is
      // worse than a small gap at the bottom, which the overlay hides anyway.
      const width = el.clientWidth;
      const colWidth = (width - 8) / 2;
      const avgTileHeight = colWidth * 0.72 + 8;
      setTilesPerColumn(Math.max(4, Math.floor(height / avgTileHeight)));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const leftTiles = Array.from({ length: tilesPerColumn }, (_, index) => index);
  const rightTiles = Array.from(
    { length: tilesPerColumn },
    (_, index) => index + tilesPerColumn
  );

  const renderTile = (index: number) => (
    <div
      className="bg-border/60 rounded-xl"
      key={`media-skeleton-${index}`}
      style={{
        aspectRatio: SKELETON_ASPECTS[index % SKELETON_ASPECTS.length],
      }}
    />
  );

  return (
    <div ref={containerRef} className="flex h-full gap-2 p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        {leftTiles.map(renderTile)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        {rightTiles.map(renderTile)}
      </div>
    </div>
  );
};

interface MediaGalleryProps {
  locked?: boolean;
  userId: string;
}

const DEFAULT_ASPECT = 4 / 5;

const SKELETON_ASPECTS = [4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5, 3 / 4];

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`);

// Matches the hover preview delay used by video thumbnails in the post feed.
const VIDEO_HOVER_DELAY = 350;

const VideoTile = ({
  aspectRatio,
  item,
}: {
  aspectRatio: number;
  item: Media;
}) => {
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handlePlaying = useCallback(() => {
    setIsVideoActive(true);
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video) {
        void (async () => {
          try {
            await video.play();
          } catch {
            // Autoplay may be blocked or aborted; ignore safely
          }
        })();
      }
    }, VIDEO_HOVER_DELAY);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
        if (video.readyState >= 1 && video.duration > 2) {
          video.currentTime = 2;
        }
      } catch {
        // Ignore seek aborts
      }
    }
    setIsVideoActive(false);
  }, []);

  // Seek past the first frame so the thumbnail shows a meaningful frame,
  // matching the post feed's video thumbnails.
  const handleLoadedMetadata = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (video.duration > 2) {
        video.currentTime = 2;
      }
    },
    []
  );

  useEffect(
    () => () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    },
    []
  );

  return (
    <div
      className="group relative w-full overflow-hidden rounded-xl shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ aspectRatio }}
    >
      <video
        aria-label="Video thumbnail"
        className="absolute inset-0 h-full w-full object-cover"
        muted
        onLoadedMetadata={handleLoadedMetadata}
        onPlaying={handlePlaying}
        playsInline
        preload="none"
        ref={videoRef}
        // Playback prefers the progressive MP4 derivative; the variant
        // route falls back to the published original when none exists.
        src={isHovered ? getMediaVideoUrl(item.id) : undefined}
      />
      {/* Thumbnail overlay crossfades out once playback actually starts */}
      <Image
        alt="Video thumbnail"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
          isVideoActive ? "opacity-0" : "opacity-100"
        )}
        fill
        sizes="176px"
        src={getMediaProxyUrl(item)}
        unoptimized
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent" />
      <div className="absolute top-2 right-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
          <MdPlayArrow className="ml-0.5 h-3.5 w-3.5 text-white" />
        </div>
      </div>
    </div>
  );
};

const AUDIO_WAVEFORM_BARS = [
  0.35, 0.6, 0.45, 0.85, 0.7, 1, 0.65, 0.9, 0.5, 0.75, 0.4, 0.65, 0.3, 0.55,
];

const AudioTile = ({
  aspectRatio,
  item: _item,
}: {
  aspectRatio: number;
  item: Media;
}) => (
  // Top-right: 3D audio icon indicator
  // Center: Sound Waveform visualizer bars
  <div
    className="group apple-panel relative flex w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-white/10 p-3 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
    style={{ aspectRatio: Math.max(0.75, Math.min(1.2, aspectRatio)) }}
  >
    <div className="absolute top-2 right-2 z-10">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4)] transition-transform duration-200 group-hover:scale-110">
        <Volume2 className="size-3.5 text-white" />
      </div>
    </div>

    <div className="relative z-10 flex h-14 w-full items-center justify-center gap-1 px-2">
      {AUDIO_WAVEFORM_BARS.map((height, idx) => (
        <span
          className="flex-1 rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] transition-all duration-300 group-hover:scale-y-110"
          key={idx}
          style={{
            height: `${height * 100}%`,
            opacity: 0.6 + height * 0.4,
          }}
        />
      ))}
    </div>
  </div>
);

const renderMediaTile = (item: Media) => {
  const aspectRatio =
    item.width && item.height ? item.width / item.height : DEFAULT_ASPECT;

  if (item.type === "VIDEO") {
    return <VideoTile aspectRatio={aspectRatio} item={item} />;
  }

  if (item.type === "AUDIO") {
    return <AudioTile aspectRatio={aspectRatio} item={item} />;
  }

  if (item.type !== "IMAGE") {
    return renderGenericFileTile(item);
  }

  return <ImageTile aspectRatio={aspectRatio} item={item} />;
};

const ImageTile = ({
  aspectRatio,
  item,
}: {
  aspectRatio: number;
  item: Media;
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isFailed, setIsFailed] = useState(false);

  if (isFailed) {
    return (
      <div
        className="group bg-muted/20 relative w-full overflow-hidden rounded-xl shadow-xs"
        style={{ aspectRatio }}
      >
        <Image
          alt="Media unavailable"
          className="h-full w-full object-cover opacity-60"
          fill
          sizes="176px"
          src={noMediaImage}
          unoptimized
        />
      </div>
    );
  }

  return (
    <div
      className="group bg-muted/20 relative w-full overflow-hidden rounded-xl shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ aspectRatio }}
    >
      {isLoading ? (
        <div className="bg-muted/40 absolute inset-0 animate-pulse" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- srcSet for responsive tiles; Next Image does not expose it with unoptimized proxy URLs */}
      <img
        alt="User media"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-all duration-300 group-hover:scale-105",
          isLoading ? "opacity-0" : "opacity-100"
        )}
        decoding="async"
        loading="lazy"
        onError={() => {
          setIsFailed(true);
          setIsLoading(false);
        }}
        onLoad={() => setIsLoading(false)}
        sizes="176px"
        src={getMediaProxyUrl(item)}
        srcSet={getMediaImageSrcSet(
          item as unknown as { id: string; mimeType?: string | null }
        )}
      />
      <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
    </div>
  );
};

const renderGenericFileTile = (item: Media) => (
  <div className="group bg-primary/5 hover:bg-primary/10 relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
    <FileIcon className="text-primary h-8 w-8" />
    <span className="text-muted-foreground max-w-full truncate text-[10px] font-medium">
      {formatFileName(item.key)}
    </span>
  </div>
);

// Gust media links to the gust page; regular post media to the post page.
function postHrefFor(item: UserMediaItem): string | null {
  if (!item.postId) {
    return null;
  }
  return getPostPath({ id: item.postId, isGust: item.post?.isGust });
}

// The aspect ratio a media tile renders at, so the moderated banner matches the
// media's size/shape exactly.
function tileAspectRatio(item: UserMediaItem): number {
  return item.width && item.height ? item.width / item.height : DEFAULT_ASPECT;
}

interface MediaTileProps {
  index: number;
  item: UserMediaItem;
  onSelect: (item: UserMediaItem, index: number) => void;
}

const MediaTile: React.FC<MediaTileProps> = ({ item, index, onSelect }) => {
  const handleClick = useCallback(
    () => onSelect(item, index),
    [item, index, onSelect]
  );
  const postHref = postHrefFor(item);
  const isModerated = Boolean(item.post?.moderated);

  // A moderated post's media is replaced by a banner exactly the same size and
  // shape as the media tile; clicking it goes straight to the post/gust page.
  if (isModerated) {
    // Same frame as the real media tile: identical aspect ratio, rounding,
    // border and shadow.
    return (
      <div className="mb-2 break-inside-avoid">
        <Link
          aria-label={`Open moderated ${item.post?.isGust ? "gust" : "post"}`}
          className="group relative block w-full"
          href={postHref ?? "#"}
          onClick={(event) => {
            if (!postHref) {
              event.preventDefault();
            }
          }}
        >
          <div
            className="bg-muted/20 border-border/60 relative w-full overflow-hidden rounded-xl border shadow-xs"
            style={{ aspectRatio: tileAspectRatio(item) }}
          >
            <div className="flex h-full w-full items-center justify-center">
              <ModeratedNotice
                bare
                className="mx-2"
                kind={item.post?.isGust ? "gust" : "post"}
                vertical
              />
            </div>
          </div>
        </Link>
        {postHref ? (
          <Link
            className="text-muted-foreground hover:text-primary mt-1 block truncate text-[11px] transition-colors duration-200"
            href={postHref}
          >
            View {item.post?.isGust ? "gust" : "post"}
          </Link>
        ) : null}
      </div>
    );
  }

  // Audio files link directly to the post page rather than opening the media viewer modal.
  if (item.type === "AUDIO") {
    return (
      <div className="mb-2 break-inside-avoid">
        <Link
          aria-label={`Open post for audio ${item.id}`}
          className="group relative block w-full text-left"
          href={postHref ?? "#"}
          onClick={(event) => {
            if (!postHref) {
              event.preventDefault();
            }
          }}
        >
          <div className="bg-muted/20 border-border/60 relative w-full overflow-hidden rounded-xl border shadow-xs">
            <div
              className={cn(
                "pointer-events-none",
                item.post?.explicitContent && "opacity-60 blur-lg saturate-50"
              )}
            >
              {renderMediaTile(item)}
            </div>
          </div>
        </Link>
        {postHref ? (
          <Link
            className="text-muted-foreground hover:text-primary mt-1 block truncate text-[11px] transition-colors duration-200"
            href={postHref}
          >
            View {item.post?.isGust ? "gust" : "post"}
          </Link>
        ) : null}
      </div>
    );
  }

  // Explicit media is shown blurred in the gallery - no gate popup, it stays
  // hidden until the media is opened. The blur sits inside a rounded bordered
  // container so it never bleeds past the tile.
  return (
    <div className="mb-2 break-inside-avoid">
      <button
        aria-label={`Open media ${item.id}`}
        className="group relative block w-full text-left"
        onClick={handleClick}
        type="button"
      >
        <div className="bg-muted/20 border-border/60 relative w-full overflow-hidden rounded-xl border shadow-xs">
          <div
            className={cn(
              "pointer-events-none",
              item.post?.explicitContent && "opacity-60 blur-lg saturate-50"
            )}
          >
            {renderMediaTile(item)}
          </div>
        </div>
      </button>
      {postHref ? (
        <Link
          className="text-muted-foreground hover:text-primary mt-1 block truncate text-[11px] transition-colors duration-200"
          href={postHref}
        >
          View {item.post?.isGust ? "gust" : "post"}
        </Link>
      ) : null}
    </div>
  );
};

interface MediaGalleryContentProps {
  bare?: boolean;
  enabled?: boolean;
  userId: string;
}

const MediaGalleryContent: React.FC<MediaGalleryContentProps> = ({
  bare = false,
  enabled = true,
  userId,
}) => {
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useUserMediaQuery(userId, enabled);

  const media = useMemo(
    () => data?.pages.flatMap((page) => page.media) || [],
    [data?.pages]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const handleSelect = useCallback(
    (item: UserMediaItem, index: number) => {
      if (item.postId) {
        // Gust media opens the gust page; regular post media opens the
        // shareable post media detail page instead of the inline viewer. The
        // gallery lists media newest-first while the destination indexes
        // post.attachments, so pass the media ID and let the route resolve
        // the true index server-side.
        if (item.post?.isGust) {
          const href = postHrefFor(item);
          if (href) {
            router.push(href);
          }
          return;
        }
        router.push(
          `${getPostMediaPath({ id: item.postId }, 0)}?mediaId=${item.id}`
        );
        return;
      }
      setSelectedMedia(item);
      setSelectedIndex(index);
    },
    [router]
  );

  const handleCloseViewer = useCallback(() => {
    setSelectedMedia(null);
    setSelectedIndex(0);
  }, []);

  let body: React.ReactNode;
  if (status === "pending") {
    body = (
      <div className="columns-2 gap-2 space-y-2 px-1">
        {SKELETON_KEYS.map((key, index) => (
          <div
            className="bg-border/40 animate-pulse rounded-xl"
            key={key}
            style={{ aspectRatio: SKELETON_ASPECTS[index] }}
          />
        ))}
      </div>
    );
  } else if (status === "error") {
    body = (
      <p className="text-destructive px-2 py-3 text-center text-sm">
        Couldn't load media.
      </p>
    );
  } else if (media.length === 0) {
    // Desktop: the empty state fills the whole sidebar height so the "no media
    // yet" message sits centered with the skeleton grid behind it. The mobile
    // media tab (bare) shows just the centered message, no background.
    body = bare ? (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Image
          alt=""
          className="h-28 w-auto object-contain opacity-90"
          draggable={false}
          height={1024}
          src={noMediaImage}
          width={1536}
        />
        <p className="text-sm font-medium">No media yet</p>
        <p className="text-muted-foreground max-w-44 text-xs">
          Media from this profile's posts will show up here
        </p>
      </div>
    ) : (
      <div className="relative flex min-h-full flex-1 flex-col">
        <MediaSkeletonGrid />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[hsl(var(--background-alt))]/75 px-6 text-center backdrop-blur-sm">
          <Image
            alt=""
            className="h-28 w-auto object-contain opacity-90"
            draggable={false}
            height={1024}
            src={noMediaImage}
            width={1536}
          />
          <p className="text-sm font-medium">No media yet</p>
          <p className="text-muted-foreground max-w-44 text-xs">
            Media from this profile's posts will show up here
          </p>
        </div>
      </div>
    );
  } else {
    body = (
      <InfiniteScrollContainer onBottomReached={handleBottomReached}>
        <div className="columns-2 gap-2 px-1">
          {media.map((item, index) => (
            <MediaTile
              index={index}
              item={item}
              key={item.id}
              onSelect={handleSelect}
            />
          ))}
        </div>
        {isFetchingNextPage ? (
          <div className="flex justify-center py-3">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
          </div>
        ) : null}
      </InfiniteScrollContainer>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col p-3">{body}</div>
      {selectedMedia ? (
        <MediaViewer
          initialIndex={selectedIndex}
          isOpen
          media={
            selectedMedia.postId
              ? media.filter((m) => m.postId === selectedMedia.postId)
              : [selectedMedia]
          }
          onClose={handleCloseViewer}
        />
      ) : null}
    </>
  );
};

const MediaGallery: React.FC<MediaGalleryProps> = ({
  locked = false,
  userId,
}) => {
  const isXl = useMediaQuery("(min-width: 1280px)");

  // Guests see a locked sidebar: a full-height skeleton grid with the login
  // prompt centered on top of it.
  if (locked) {
    return (
      <aside className="hide-native-scrollbar relative hidden h-screen w-full max-w-sm shrink-0 flex-col overflow-hidden xl:flex">
        <MediaGalleryLocked />
      </aside>
    );
  }

  return (
    <aside className="hide-native-scrollbar hidden h-screen w-full max-w-sm shrink-0 flex-col overflow-y-auto xl:flex">
      <MediaGalleryContent enabled={!locked && isXl} userId={userId} />
    </aside>
  );
};

export { MediaGalleryContent };
export default MediaGallery;
