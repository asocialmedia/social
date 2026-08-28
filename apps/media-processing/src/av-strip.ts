// Lossless metadata scrub for published video/audio ORIGINALS. Static rasters
// are scrubbed structurally (packages/media strip-metadata); video and audio
// containers carry EXIF-class metadata too (QuickTime udta keys, MP4 ilst,
// ID3, XMP, GPS in phone recordings, cover-art-adjacent tags), so the exact
// bytes promoted to the published key get a stream-copy remux with all
// metadata dropped before stamping.
//
// Losslessness: `-c copy` never touches encoded packets, so there is zero
// generational quality loss and the remux is I/O-fast even for 250MB videos.
// What survives the scrub is structural (codec headers, handler names,
// language tags, brands, the rotation display matrix) - never user content.
//
// Failure contract: any ffmpeg failure throws; the scan stage catches and
// publishes the scanned bytes unmodified rather than blocking the upload,
// mirroring the image stripper's fallback.

import { avContainerExtension, needsFaststart } from "@asm/media";

import { runFfmpeg } from "./ffmpeg";

export interface AvStripPlan {
  extension: string;
  faststart: boolean;
}

// Resolves the output muxer for a content-detected container. Returns null
// when the container has no known extension mapping - callers then publish
// the scanned bytes unmodified instead of guessing.
export function planAvStrip(container: string): AvStripPlan | null {
  const extension = avContainerExtension(container);
  if (!extension) {
    return null;
  }
  return { extension, faststart: needsFaststart(container) };
}

// Writes a metadata-free copy of `inputPath` to `outputPath`. Output format
// follows the extension so ffmpeg picks the matching muxer; ISO-BMFF family
// outputs are faststarted for progressive browser playback.
export async function stripAvContainerMetadata(input: {
  container: string;
  inputPath: string;
  outputPath: string;
  timeoutMs: number;
}): Promise<void> {
  const plan = planAvStrip(input.container);
  if (!plan) {
    throw new Error(`no remux muxer for container "${input.container}"`);
  }
  await runFfmpeg(
    [
      "-i",
      input.inputPath,
      "-map",
      "0",
      // Global tags (ID3, QuickTime keys, XMP), per-stream tags and chapter
      // titles all go. Chapters themselves survive as timeline data; only
      // their metadata is dropped.
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-c",
      "copy",
      ...(plan.faststart ? ["-movflags", "+faststart"] : []),
      input.outputPath,
    ],
    input.timeoutMs
  );
}
