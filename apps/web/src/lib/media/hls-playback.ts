// Prefer MSE playback when available: some browsers advertise native HLS without reliable stream support.
export function hlsPlaybackMode(
  hlsJsSupported: boolean,
  nativeSupported: boolean
) {
  if (hlsJsSupported) {
    return "hls.js";
  }
  return nativeSupported ? "native" : "unsupported";
}
