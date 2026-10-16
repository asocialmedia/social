export function recordingMimeType(
  supported: (mime: string) => boolean
): string | undefined {
  return [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find(supported);
}

// Browsers save a download; native writes directly to the photo library.
export function saveCameraDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function capturePhoto(
  video: HTMLVideoElement,
  mirror: boolean
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Camera capture isn't supported by this browser.");
  }
  if (mirror) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  // oxlint-disable-next-line promise/avoid-new -- canvas.toBlob exposes a callback-only API.
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });
  if (!blob) {
    throw new Error("Couldn't encode that photo.");
  }
  return new File([blob], `fleet-${Date.now()}.jpg`, { type: "image/jpeg" });
}
