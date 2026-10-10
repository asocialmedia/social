// Gallery persistence for camera captures. Auto-save is the product call here:
// every shutter press lands in the user's photo library, the composer upload
// is a separate pipeline that reads the cached file.
// MediaLibrary permission is requested lazily on first save, never at boot.
import * as MediaLibrary from "expo-media-library";

import { logError, logInfo, logWarn } from "@/lib/telemetry";

export async function saveCaptureToGallery(uri: string): Promise<boolean> {
  try {
    const current = await MediaLibrary.getPermissionsAsync();
    let { granted } = current;
    if (!granted && current.canAskAgain) {
      const { granted: fresh } =
        await MediaLibrary.requestPermissionsAsync(true);
      granted = fresh;
    }
    if (!granted) {
      // Permission denied: the capture still continues to the composer, the
      // file just is not duplicated into the gallery.
      logWarn("camera.gallery_denied", {});
      return false;
    }
    await MediaLibrary.createAssetAsync(uri);
    logInfo("camera.gallery_saved", {});
    return true;
  } catch (error) {
    logError("camera.gallery_save_failed", error);
    return false;
  }
}

// Latest thumbnail for the gallery button. Returns null when the library is
// unavailable or permission is denied, the button then falls back to an icon.
export async function latestGalleryThumb(): Promise<string | null> {
  try {
    const current = await MediaLibrary.getPermissionsAsync();
    if (!current.granted) {
      return null;
    }
    const result = await MediaLibrary.getAssetsAsync({
      first: 1,
      mediaType: ["photo", "video"],
      sortBy: [["creationTime", false]],
    });
    return result.assets[0]?.uri ?? null;
  } catch (error) {
    logWarn("camera.thumb_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
