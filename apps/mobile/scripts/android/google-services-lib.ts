// Pure helpers for resolving and validating google-services.json at APK build
// time. No filesystem or env access here, so they unit-test on Node - the
// build script supplies the paths and file contents. Mirrors the
// dev-android-lib.ts split.

// The Android package every FCM registration is scoped to.
export const EXPECTED_ANDROID_PACKAGE = "cc.asocialmedia.mobile";

export interface GoogleServicesValidation {
  // Present only when ok is false.
  error?: string;
  ok: boolean;
  packageName?: string;
  projectId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

// Validates the shape and identity of a google-services.json payload. A file
// that parses but names another package would register the wrong application,
// so the build must reject it rather than ship an APK whose push is dead.
export function validateGoogleServices(
  content: string
): GoogleServicesValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { error: "is not valid JSON", ok: false };
  }

  const root = asRecord(parsed);
  if (!root) {
    return { error: "is not a JSON object", ok: false };
  }

  const projectInfo = asRecord(root.project_info);
  const projectId = projectInfo?.project_id;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return { error: "has no project_info.project_id", ok: false };
  }

  const clients = Array.isArray(root.client) ? root.client : [];
  const packageName = clients
    .map((client) => asRecord(client))
    .map((client) => asRecord(client?.client_info))
    .map((info) => asRecord(info?.android_client_info))
    .map((android) => android?.package_name)
    .find((name): name is string => typeof name === "string");

  if (packageName !== EXPECTED_ANDROID_PACKAGE) {
    return {
      error: `targets package "${packageName ?? "unknown"}", expected "${EXPECTED_ANDROID_PACKAGE}"`,
      ok: false,
    };
  }

  return { ok: true, packageName, projectId };
}

export interface GoogleServicesCandidate {
  path: string;
  source: string;
}

export interface GoogleServicesCandidateInput {
  // Explicit GOOGLE_SERVICES_JSON override, if set.
  explicitPath: string | null;
  // apps/mobile/google-services.json - where a previous build provisioned it.
  mobileFile: string;
  // <repo>/google-services.json - local dev convenience.
  rootFile: string;
}

// Ordered resolution candidates, first match wins. The explicit override leads;
// the app-local file precedes the repo root so a provisioned copy is not
// shadowed by a stale root one.
export function googleServicesCandidates(
  input: GoogleServicesCandidateInput
): GoogleServicesCandidate[] {
  const candidates: GoogleServicesCandidate[] = [];
  if (input.explicitPath) {
    candidates.push({ path: input.explicitPath, source: input.explicitPath });
  }
  candidates.push(
    {
      path: input.mobileFile,
      source: "apps/mobile/google-services.json",
    },
    {
      path: input.rootFile,
      source: "google-services.json (repo root)",
    }
  );
  return candidates;
}

// Picks the first candidate whose content was read successfully, preserving the
// candidate order. `contents` is index-aligned with `candidates` (null = the
// file was missing). Returns null when none existed.
export function pickFirstExisting<T>(
  candidates: GoogleServicesCandidate[],
  contents: (T | null)[]
): { content: T; source: string } | null {
  for (const [index, candidate] of candidates.entries()) {
    const content = contents[index];
    if (content !== null && content !== undefined) {
      return { content, source: candidate.source };
    }
  }
  return null;
}
