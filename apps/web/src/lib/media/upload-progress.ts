"use client";

import type { UploadStage } from "@/lib/media/media-upload-client";

// Single unified progress mapper combining upload byte progression and
// server-side processing states into one continuous 0-100% flow. Lives in its
// own module (not attachment-preview) so lightweight callers like the message
// composer don't pull the whole post editor's media bundle in.
export function getUploadProgressInfo(
  stage?: UploadStage,
  progress?: number
): { label: string; percent: number } {
  switch (stage) {
    case "queued": {
      return { label: "55% · Queued…", percent: 55 };
    }
    case "scanning": {
      return { label: "75% · Scanning…", percent: 75 };
    }
    case "processing": {
      return { label: "90% · Processing…", percent: 90 };
    }
    default: {
      const p = Math.max(1, Math.min(50, Math.round((progress ?? 0) * 0.5)));
      return { label: `${p}% · Uploading…`, percent: p };
    }
  }
}
