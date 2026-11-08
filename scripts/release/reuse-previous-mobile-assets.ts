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
  return release.assets.some(
    (asset) =>
      asset.name.startsWith("asocialmedia-") && asset.name.endsWith(".apk")
  );
}

// Releases list newest-first, so the first hit is the newest APK to reuse.
export function selectReleaseWithApk(
  releases: ReleaseAssets[]
): ReleaseAssets | null {
  return releases.find((release) => hasMobileAsset(release)) ?? null;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
type RunGh = (args: string[]) => Promise<CommandResult>;

async function runGhCommand(args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(["gh", ...args], { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function ghJson<T>(
  args: string[],
  runGh: RunGh,
  wait: (ms: number) => Promise<unknown>
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await runGh(args);
      if (result.exitCode !== 0)
        throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
      return JSON.parse(result.stdout) as T;
    } catch (error) {
      if (attempt === 2) throw error;
      await wait(250 * (attempt + 1));
    }
  }
}

async function findNewestReleaseWithApk(
  limit: number,
  runGh: RunGh,
  wait: (ms: number) => Promise<unknown>
): Promise<string | null> {
  const tags = await ghJson<Array<{ tagName: string }>>(
    ["release", "list", "--limit", String(limit), "--json", "tagName"],
    runGh,
    wait
  );
  // One metadata call per release, newest-first, stopping at the first hit;
  // a long APK-less streak costs a few extra API calls, not a full download.
  for (const { tagName } of tags) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design: stop at the first hit
    const release = await ghJson<{ assets: Array<{ name: string }> }>(
      ["release", "view", tagName, "--json", "assets"],
      runGh,
      wait
    );
    if (hasMobileAsset({ assets: release.assets, tagName })) {
      return tagName;
    }
  }
  return null;
}

export async function reusePreviousMobileAssets(
  options: {
    repoRoot?: string;
    env?: Record<string, string | undefined>;
    runGh?: RunGh;
    wait?: (ms: number) => Promise<unknown>;
    logger?: Pick<typeof console, "log" | "warn">;
  } = {}
): Promise<void> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const runGh = options.runGh ?? runGhCommand;
  const wait = options.wait ?? Bun.sleep;
  const logger = options.logger ?? console;
  const artifactDir = env.ARTIFACT_DIR
    ? path.resolve(repoRoot, env.ARTIFACT_DIR)
    : path.join(repoRoot, "build-artifacts");
  await mkdir(artifactDir, { recursive: true });

  let tagName: string | null;
  try {
    tagName = await findNewestReleaseWithApk(50, runGh, wait);
  } catch (error) {
    logger.warn(
      `Previous mobile release lookup unavailable; publishing without reused assets: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  if (!tagName) {
    logger.warn(
      "No previous release carries an asocialmedia APK; publishing without mobile assets."
    );
    return;
  }

  const patterns = MOBILE_ASSET_PATTERNS.flatMap((pattern) => [
    "--pattern",
    pattern,
  ]);
  const {
    stdout: downloadOut,
    stderr: downloadErr,
    exitCode: downloadCode,
  } = await runGh([
    "release",
    "download",
    tagName,
    ...patterns,
    "--dir",
    artifactDir,
    "--clobber",
  ]);
  if (downloadCode !== 0) {
    throw new Error(`gh release download failed: ${downloadErr.trim()}`);
  }
  logger.log(downloadOut.trim());
  logger.log(`Reused mobile assets from ${tagName} into ${artifactDir}.`);

  const githubEnv = env.GITHUB_ENV;
  if (githubEnv) {
    // GITHUB_ENV is append-only; one line per variable.
    await appendFile(githubEnv, `REUSED_APK_TAG=${tagName}\n`);
  }
}

if (import.meta.main) {
  await reusePreviousMobileAssets().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to reuse previous mobile assets: ${message}`);
    process.exitCode = 1;
  });
}
