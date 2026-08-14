"use client";

import type { Media } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noMediaImage from "@assets/general/nomedia.png";
import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  ImageIcon,
  Loader2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import { useMediaQuery } from "usehooks-ts";

import MediaViewer from "@/components/home/feedview/media-viewer";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import { useUserMediaQuery } from "@/hooks/use-user-media-query";
import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";

// Full skeleton grid with the login prompt centered on top. Shared between the
// desktop locked sidebar and the mobile media tab so guests see the same look.
// Two explicit columns with alternating aspect ratios guarantee a Pinterest
// style masonry arrangement on every screen width.
export const MediaGalleryLocked: React.FC = () => {
  const tileIndexes = Array.from({ length: 4 }, (_, index) => index);
  const leftTiles = tileIndexes.filter((index) => index % 2 === 0);
  const rightTiles = tileIndexes.filter((index) => index % 2 === 1);

  const renderTile = (index: number) => (
    <div
      className="bg-border/60 rounded-xl"
      key={`locked-skeleton-${index}`}
      style={{
        aspectRatio: SKELETON_ASPECTS[index % SKELETON_ASPECTS.length],
      }}
    />
  );

  return (
    <div className="relative">
      <div className="flex gap-2 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {leftTiles.map(renderTile)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {rightTiles.map(renderTile)}
        </div>
      </div>
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
};

interface MediaGalleryProps {
  locked?: boolean;
  userId: string;
}

const DEFAULT_ASPECT = 4 / 5;

const SKELETON_ASPECTS = [4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5, 3 / 4];

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`);

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

// Matches the hover preview delay used by video thumbnails in the post feed.
const VIDEO_HOVER_DELAY = 350;

const VideoTile = ({
  aspectRatio,
  item,
}: {
  aspectRatio: number;
  item: Media;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      try {
        void videoRef.current?.play();
      } catch {
        // Autoplay may be blocked; ignore
      }
    }, VIDEO_HOVER_DELAY);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (video.duration > 2) {
        video.currentTime = 2;
      }
    }
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
        playsInline
        preload="metadata"
        ref={videoRef}
        src={getMediaUrl(item.id)}
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

const renderMediaTile = (item: Media) => {
  const aspectRatio =
    item.width && item.height ? item.width / item.height : DEFAULT_ASPECT;

  if (item.type === "VIDEO") {
    return <VideoTile aspectRatio={aspectRatio} item={item} />;
  }

  if (item.type === "AUDIO") {
    return (
      <div
        className="group bg-primary/5 hover:bg-primary/10 relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <FileAudioIcon className="text-primary h-8 w-8" />
        <span className="text-muted-foreground max-w-full truncate text-[10px]">
          {formatFileName(item.key)}
        </span>
      </div>
    );
  }

  if (item.type === "CODE") {
    return (
      <div
        className="group bg-primary/5 hover:bg-primary/10 relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <FileCode className="text-primary h-8 w-8" />
        <span className="text-muted-foreground max-w-full truncate text-[10px] font-medium">
          {formatFileName(item.key)}
        </span>
        <span className="text-muted-foreground/70 max-w-full truncate text-[9px] tracking-wide uppercase">
          {getLanguageFromFileName(item.key)}
        </span>
      </div>
    );
  }

  if (item.type === "DOCUMENT") {
    return (
      <div
        className="group bg-primary/5 hover:bg-primary/10 relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <FileIcon className="text-primary h-8 w-8" />
        <span className="text-muted-foreground max-w-full truncate text-[10px] font-medium">
          {formatFileName(item.key)}
        </span>
        <span className="text-muted-foreground/70 max-w-full truncate text-[9px] tracking-wide uppercase">
          {item.mimeType}
        </span>
      </div>
    );
  }

  if (item.type !== "IMAGE") {
    return renderGenericFileTile(item);
  }

  return (
    <div
      className="group relative w-full overflow-hidden rounded-xl bg-[hsl(var(--background))] shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ aspectRatio }}
    >
      <Image
        alt="User media"
        className="object-cover transition-transform duration-300 group-hover:scale-105"
        fill
        sizes="176px"
        src={getMediaUrl(item.id)}
        unoptimized
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

interface MediaTileProps {
  index: number;
  item: Media;
  onSelect: (item: Media, index: number) => void;
}

const MediaTile: React.FC<MediaTileProps> = ({ item, index, onSelect }) => {
  const handleClick = useCallback(
    () => onSelect(item, index),
    [item, index, onSelect]
  );
  const postHref = item.postId ? `/posts/${item.postId}` : null;

  return (
    <div className="mb-2 break-inside-avoid">
      <button
        aria-label={`Open media ${item.id}`}
        className="group relative block w-full text-left"
        onClick={handleClick}
        type="button"
      >
        {renderMediaTile(item)}
      </button>
      {postHref ? (
        <Link
          className="text-muted-foreground hover:text-primary mt-1 block truncate text-[11px] transition-colors duration-200"
          href={postHref}
        >
          View post
        </Link>
      ) : null}
    </div>
  );
};

interface MediaGalleryContentProps {
  enabled?: boolean;
  userId: string;
}

const MediaGalleryContent: React.FC<MediaGalleryContentProps> = ({
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
    (item: Media, index: number) => {
      if (item.postId) {
        // Open the shareable post media detail page instead of the inline
        // viewer. The gallery lists media newest-first while the destination
        // indexes post.attachments, so pass the media ID and let the route
        // resolve the true index server-side.
        router.push(`/posts/${item.postId}/media/0?mediaId=${item.id}`);
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
    body = (
      <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
        <ImageIcon className="text-muted-foreground/60 h-5 w-5" />
        <p className="text-muted-foreground text-sm">No media yet</p>
        <p className="text-muted-foreground/70 text-xs">
          Media from this profile's posts will show up here
        </p>
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
      <div className="p-3">{body}</div>
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
  const { data, status } = useUserMediaQuery(userId, isXl && !locked);
  const media = useMemo(
    () => data?.pages.flatMap((page) => page.media) || [],
    [data?.pages]
  );

  // Guests see a locked sidebar: a full-height skeleton grid with the login
  // prompt centered on top of it.
  if (locked) {
    return (
      <aside className="hide-native-scrollbar relative hidden h-screen w-full max-w-sm shrink-0 flex-col overflow-hidden xl:flex">
        <MediaGalleryLocked />
      </aside>
    );
  }

  // Hide the sidebar entirely for profiles with no media so the feed takes the space.
  if (status === "success" && media.length === 0) {
    return null;
  }

  return (
    <aside className="hide-native-scrollbar hidden h-screen w-full max-w-sm shrink-0 flex-col overflow-y-auto xl:flex">
      <MediaGalleryContent enabled={isXl} userId={userId} />
    </aside>
  );
};

export { MediaGalleryContent };
export default MediaGallery;
