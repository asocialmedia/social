// Server media lifecycle -> composer stages and copy, ported from web's
// media-upload-client (watchMediaStatus mapping, rejectionCopy) and
// attachment-preview (getUploadProgressInfo). Pure for unit tests.

export type ServerMediaStatus =
  | "DELETED"
  | "FAILED"
  | "PROCESSING"
  | "QUARANTINED"
  | "READY"
  | "REJECTED"
  | "SCANNING"
  | "UPLOADING";

export type UploadStage =
  | "error"
  | "processing"
  | "queued"
  | "ready"
  | "scanning"
  | "uploading";

export function stageForStatus(status: string): UploadStage {
  switch (status) {
    case "UPLOADING": {
      return "uploading";
    }
    case "QUARANTINED": {
      return "queued";
    }
    case "SCANNING": {
      return "scanning";
    }
    case "PROCESSING": {
      return "processing";
    }
    case "READY": {
      return "ready";
    }
    default: {
      return "error";
    }
  }
}

export function isTerminalStatus(status: string): boolean {
  return (
    status === "READY" ||
    status === "REJECTED" ||
    status === "DELETED" ||
    status === "FAILED"
  );
}

// TOO_LARGE covers both the per-family byte caps and the antivirus
// scanner's stream limit.
export function rejectionCopy(reason?: string | null): string {
  switch (reason) {
    case "MALWARE": {
      return "Security scan found a threat in this file.";
    }
    case "MIME_MISMATCH": {
      return "The file's contents don't match its type.";
    }
    case "TOO_LARGE": {
      return "This file is too large to process.";
    }
    case "TOO_LONG": {
      return "This file is longer than allowed.";
    }
    case "CORRUPT": {
      return "The file appears to be corrupted.";
    }
    case "UNSUPPORTED_TYPE": {
      return "This file type isn't supported.";
    }
    case "POLICY": {
      return "This file violates the content policy.";
    }
    default: {
      return "This attachment was rejected.";
    }
  }
}

// One continuous 0-100% flow: bytes fill 1-50%, then the server stages.
export function uploadProgressInfo(
  stage: UploadStage | undefined,
  bytesPercent: number
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
      const percent = Math.max(
        1,
        Math.min(50, Math.round((bytesPercent || 0) * 0.5))
      );
      return { label: `${percent}% · Uploading…`, percent };
    }
  }
}

export function stageLabel(stage: UploadStage | undefined): string {
  switch (stage) {
    case "queued": {
      return "queue";
    }
    case "scanning": {
      return "scan";
    }
    case "processing": {
      return "processing";
    }
    default: {
      return "upload";
    }
  }
}
