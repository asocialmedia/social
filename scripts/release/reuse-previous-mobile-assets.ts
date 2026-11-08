// Re-attaches the mobile APK/AAB from the newest previous release that ships
// one, so a main push without apps/mobile changes still publishes an
// installable APK instead of an empty release. Exits 0 with a warning when no
// previous release carries mobile assets, leaving the release APK-less as today.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Only asocialmedia mobile binaries travel with the GitHub Release; container
// images publish to GHCR and must never be re-attached here.
const MOBILE_ASSET_PATTERNS = [
  "asocialmedia-*.apk",
  "asocialmedia-*.aab",
  "asocialmedia-*.apk.sha256",
  "asocialmedia-*.aab.sha256",
];

interface ReleaseAssets {
  assets: Array<{ name: string }>;
  tagName: string;
}

export function hasMobileAsset(release: ReleaseAssets): boolean {
  return release.assets.some((asset) => asset.name.endsWith(".apk"));
}

// Releases list newest-first, so the first hit is the newest APK to reuse.
export function selectReleaseWithApk(
  releases: ReleaseAssets[]
): ReleaseAssets | null {
  return releases.find((release) => hasMobileAsset(release)) ?? null;
}

async function ghJson<T>(args: string[]): Promise<T> {
  const proc = Bun.spawn(["gh", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return JSON.parse(stdout) as T;
}

async function findNewestReleaseWithApk(limit: number): Promise<string | null> {
  const tags = await ghJson<Array<{ tagName: string }>>([
    "release",
    "list",
    "--limit",
    String(limit),
    "--json",
    "tagName",
  ]);
  // One metadata call per release, newest-first, stopping at the first hit;
  // a long APK-less streak costs a few extra API calls, not a full download.
  for (const { tagName } of tags) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design: stop at the first hit
    const release = await ghJson<{ assets: Array<{ name: string }> }>([
      "release",
      "view",
      tagName,
      "--json",
      "assets",
    ]);
    if (hasMobileAsset({ assets: release.assets, tagName })) {
      return tagName;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const artifactDir = process.env.ARTIFACT_DIR
    ? path.resolve(repoRoot, process.env.ARTIFACT_DIR)
    : path.join(repoRoot, "build-artifacts");
  await mkdir(artifactDir, { recursive: true });

  const tagName = await findNewestReleaseWithApk(50);
  if (!tagName) {
    console.warn(
      "No previous release carries an asocialmedia APK; publishing without mobile assets."
    );
    return;
  }

  const patterns = MOBILE_ASSET_PATTERNS.flatMap((pattern) => [
    "--pattern",
    pattern,
  ]);
  const download = Bun.spawn(
    [
      "gh",
      "release",
      "download",
      tagName,
      ...patterns,
      "--dir",
      artifactDir,
      "--clobber",
    ],
    { stderr: "pipe", stdout: "pipe" }
  );
  const [downloadOut, downloadErr, downloadCode] = await Promise.all([
    new Response(download.stdout).text(),
    new Response(download.stderr).text(),
    download.exited,
  ]);
  if (downloadCode !== 0) {
    throw new Error(`gh release download failed: ${downloadErr.trim()}`);
  }
  console.log(downloadOut.trim());
  console.log(`Reused mobile assets from ${tagName} into ${artifactDir}.`);

  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    // GITHUB_ENV is append-only; one line per variable.
    await appendFile(githubEnv, `REUSED_APK_TAG=${tagName}\n`);
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to reuse previous mobile assets: ${message}`);
    process.exitCode = 1;
  });
}
