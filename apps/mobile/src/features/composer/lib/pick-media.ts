// Native equivalents of the web composer's file inputs:
//   "Photos & Videos"  -> system photo library (multi-select, capped at the
//                         remaining attachment slots)
//   "Audio Files"      -> system document picker filtered to audio
//   GIFs               -> the chosen KLIPY GIF downloaded into the cache
// Everything resolves to PickedMedia (uri, name, mime, size, dimensions)
// for the attachment store; picker cancellation resolves to [].
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";

import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import { logWarn } from "@/lib/telemetry";

function extensionMime(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    avi: "video/x-msvideo",
    gif: "image/gif",
    heic: "image/heic",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    m4a: "audio/mp4",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    png: "image/png",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
  };
  return known[ext] ?? null;
}

function sizeOf(uri: string, reported?: number | null): number {
  if (reported && reported > 0) {
    return reported;
  }
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

function pickerTypes(options: {
  imagesOnly?: boolean;
  videoOnly?: boolean;
}): ImagePicker.MediaType[] {
  if (options.videoOnly) {
    return ["videos"];
  }
  if (options.imagesOnly) {
    return ["images"];
  }
  return ["images", "videos"];
}

export async function pickPhotosAndVideos(options: {
  imagesOnly?: boolean;
  remaining: number;
  videoOnly?: boolean;
}): Promise<PickedMedia[]> {
  if (options.remaining <= 0) {
    return [];
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsMultipleSelection: options.remaining > 1,
    mediaTypes: pickerTypes(options),
    // Originals: the server strips metadata and builds every derivative.
    quality: 1,
    selectionLimit: options.remaining,
    videoMaxDuration: 0,
  });
  if (result.canceled) {
    return [];
  }
  return result.assets.slice(0, options.remaining).map((asset) => {
    const name =
      asset.fileName ??
      asset.uri.split("/").pop() ??
      (asset.type === "video" ? "video.mp4" : "image.jpg");
    return {
      durationMs: asset.duration ?? null,
      height: asset.height || undefined,
      mimeType:
        asset.mimeType ??
        extensionMime(name) ??
        (asset.type === "video" ? "video/mp4" : "image/jpeg"),
      name,
      size: sizeOf(asset.uri, asset.fileSize),
      uri: asset.uri,
      width: asset.width || undefined,
    };
  });
}

export async function pickAudioFile(): Promise<PickedMedia[]> {
  const picked = await File.pickFileAsync({ mimeTypes: ["audio/*"] });
  if (picked.canceled) {
    return [];
  }
  const file = picked.result;
  const name = file.name || "audio";
  return [
    {
      mimeType: file.type || extensionMime(name) || "audio/mpeg",
      name,
      size: file.size,
      uri: file.uri,
    },
  ];
}

export interface KlipyGif {
  id: number | string;
  preview: string;
  slug: string;
  title: string;
  url: string;
}

// Web fetches the GIF bytes and feeds them to the uploader as a file; native
// downloads into the cache and does the same.
export async function downloadGif(gif: KlipyGif): Promise<PickedMedia> {
  const directory = new Directory(Paths.cache, "asm-gifs");
  if (!directory.exists) {
    directory.create({ idempotent: true, intermediates: true });
  }
  const safeSlug = (gif.slug || "gif").replaceAll(/[^\w-]/g, "").slice(0, 60);
  const target = new File(directory, `${safeSlug || "gif"}-${Date.now()}.gif`);
  try {
    const file = await File.downloadFileAsync(gif.url, target, {
      idempotent: true,
    });
    return {
      mimeType: "image/gif",
      name: `${gif.slug || "gif"}.gif`,
      size: file.size,
      uri: file.uri,
    };
  } catch (error) {
    logWarn("composer.gif_download_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}
