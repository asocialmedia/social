import type { Media } from "@/lib/types";

// Share the asset itself when supported; other browsers share or copy its download link.
export async function shareHeldMedia(
  media: Media,
  signal: AbortSignal
): Promise<boolean> {
  const url = new URL(`/api/media/download/${media.id}`, window.location.origin)
    .href;
  if (navigator.canShare && navigator.share) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error("Media download failed");
    }
    const blob = await response.blob();
    const extension =
      blob.type.split("/")[1]?.replace("jpeg", "jpg") ??
      (media.type === "VIDEO" ? "mp4" : "jpg");
    const file = new File([blob], `asocialmedia-${media.id}.${extension}`, {
      type: blob.type,
    });
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Share media" });
      return false;
    }
  }
  if (navigator.share) {
    await navigator.share({ title: "Share media", url });
    return false;
  }
  await navigator.clipboard.writeText(url);
  return true;
}
