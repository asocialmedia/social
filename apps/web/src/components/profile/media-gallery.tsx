"use client";

import type { Media } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  ImageIcon,
  Loader2,
  ScanSearch,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { MdPlayArrow } from "react-icons/md";
import MediaViewer from "@/components/home/feedview/media-viewer";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import { getLanguageFromFileName } from "@/lib/codefile-extensions";
import { formatFileName } from "@/lib/format-file-name";
import kyInstance from "@/lib/ky";

interface MediaPage {
  media: Media[];
  nextCursor: string | null;
}

interface MediaGalleryProps {
  userId: string;
}

const DEFAULT_ASPECT = 4 / 5;

const SKELETON_ASPECTS = [4 / 5, 3 / 4, 1, 4 / 5, 3 / 4, 1, 4 / 5, 3 / 4];

const SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `skeleton-${i}`);

const getMediaUrl = (mediaId: string) => `/api/media/${mediaId}`;

const renderMediaTile = (item: Media) => {
  const aspectRatio =
    item.width && item.height ? item.width / item.height : DEFAULT_ASPECT;

  if (item.type === "VIDEO") {
    return (
      <div
        className="group relative w-full overflow-hidden rounded-xl shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <video
          aria-label="Video thumbnail"
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          src={getMediaUrl(item.id)}
        />
        <div className="absolute inset-0 bg-linear-to-t from-black/50 via-transparent to-transparent" />
        <span className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-xs transition-transform duration-300 group-hover:scale-110">
          <MdPlayArrow className="h-6 w-6 text-white" />
        </span>
      </div>
    );
  }

  if (item.type === "AUDIO") {
    return (
      <div
        className="group relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary/5 p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <FileAudioIcon className="h-8 w-8 text-primary" />
        <span className="max-w-full truncate text-[10px] text-muted-foreground">
          {formatFileName(item.key)}
        </span>
      </div>
    );
  }

  if (item.type === "CODE") {
    return (
      <div
        className="group relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary/5 p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <FileCode className="h-8 w-8 text-primary" />
        <span className="max-w-full truncate font-medium text-[10px] text-muted-foreground">
          {formatFileName(item.key)}
        </span>
        <span className="max-w-full truncate text-[9px] text-muted-foreground/70 uppercase tracking-wide">
          {getLanguageFromFileName(item.key)}
        </span>
      </div>
    );
  }

  if (item.type === "DOCUMENT") {
    return (
      <div
        className="group relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary/5 p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-md"
        style={{ aspectRatio }}
      >
        <FileIcon className="h-8 w-8 text-primary" />
        <span className="max-w-full truncate font-medium text-[10px] text-muted-foreground">
          {formatFileName(item.key)}
        </span>
        <span className="max-w-full truncate text-[9px] text-muted-foreground/70 uppercase tracking-wide">
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
      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="rounded-full bg-black/50 p-2 backdrop-blur-xs">
          <ScanSearch className="h-4 w-4 text-white" />
        </span>
      </span>
    </div>
  );
};

const renderGenericFileTile = (item: Media) => (
  <div className="group relative flex w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary/5 p-4 shadow-xs transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/10 hover:shadow-md">
    <FileIcon className="h-8 w-8 text-primary" />
    <span className="max-w-full truncate font-medium text-[10px] text-muted-foreground">
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
          className="mt-1 block truncate text-[11px] text-muted-foreground transition-colors duration-200 hover:text-primary"
          href={postHref}
        >
          View post
        </Link>
      ) : null}
    </div>
  );
};

const MediaGallery: React.FC<MediaGalleryProps> = ({ userId }) => {
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["media-gallery", userId],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/media`,
          pageParam ? { searchParams: { cursor: pageParam } } : undefined
        )
        .json<MediaPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 1000 * 60,
  });

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
      const postMedia = media.filter(
        (m) => m.postId !== null && m.postId === item.postId
      );
      if (postMedia.length > 0) {
        setSelectedMedia(item);
        setSelectedIndex(
          Math.max(
            postMedia.findIndex((m) => m.id === item.id),
            0
          )
        );
        return;
      }
      setSelectedMedia(item);
      setSelectedIndex(index);
    },
    [media]
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
            className="animate-pulse rounded-xl bg-border/40"
            key={key}
            style={{ aspectRatio: SKELETON_ASPECTS[index] }}
          />
        ))}
      </div>
    );
  } else if (status === "error") {
    body = (
      <p className="px-2 py-3 text-center text-destructive text-sm">
        Couldn't load media.
      </p>
    );
  } else if (media.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
        <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
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
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : null}
      </InfiniteScrollContainer>
    );
  }

  return (
    <aside className="hide-native-scrollbar hidden h-screen w-full max-w-sm shrink-0 flex-col overflow-y-auto xl:flex">
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
    </aside>
  );
};

export default MediaGallery;
