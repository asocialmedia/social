import {
  Asset,
  AssetField,
  Query,
  getPermissionsAsync,
  requestPermissionsAsync,
} from "expo-media-library";

import { logError, logInfo, logWarn } from "@/lib/telemetry";

import { createCaptureSaver } from "./capture-save";

export const saveCaptureToGallery = createCaptureSaver(async (uri) => {
  try {
    const current = await getPermissionsAsync(true);
    const permission =
      !current.granted && current.canAskAgain
        ? await requestPermissionsAsync(true)
        : current;
    if (!permission.granted) {
      logWarn("camera.gallery_denied", {});
      return { reason: "denied", saved: false };
    }
    await Asset.create(uri);
    logInfo("camera.gallery_saved", {});
    return { saved: true };
  } catch (error) {
    logError("camera.gallery_save_failed", error);
    return { reason: "failed", saved: false };
  }
});

export async function latestGalleryThumb(): Promise<string | null> {
  try {
    const current = await getPermissionsAsync(false, ["photo", "video"]);
    if (!current.granted) {
      return null;
    }
    const [asset] = await new Query()
      .orderBy({ ascending: false, key: AssetField.CREATION_TIME })
      .limit(1)
      .exe();
    return asset ? await asset.getUri() : null;
  } catch {
    return null;
  }
}
