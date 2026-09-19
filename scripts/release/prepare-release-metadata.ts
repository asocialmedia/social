import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatReleaseNotes } from "./generate-release-notes";
import type {
  ContainerImageInfo,
  MobileArtifactInfo,
  ReleaseCommit,
  ReleaseNotesOptions,
  WorkspaceVersions,
} from "./generate-release-notes";

interface PackageJson {
  version?: string;
  [key: string]: unknown;
}

interface AppJson {
  expo?: {
    version?: string;
    [key: string]: unknown;
  };
  version?: string;
  [key: string]: unknown;
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function readVersionFromPackage(
  filePath: string
): Promise<string | null> {
  const content = await safeReadFile(filePath);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as PackageJson;
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function readVersionFromAppJson(
  filePath: string
): Promise<string | null> {
  const content = await safeReadFile(filePath);
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as AppJson;
    return parsed.expo?.version ?? parsed.version ?? null;
  } catch {
    return null;
  }
}

async function getWorkspaceVersions(
  repoRoot: string
): Promise<WorkspaceVersions> {
  const root =
    (await readVersionFromPackage(path.join(repoRoot, "package.json"))) ??
    "0.0.0";
  const web = await readVersionFromPackage(
    path.join(repoRoot, "apps/web/package.json")
  );
  const auth = await readVersionFromPackage(
    path.join(repoRoot, "apps/auth/package.json")
  );
  const mediaProcessing = await readVersionFromPackage(
    path.join(repoRoot, "apps/media-processing/package.json")
  );
  const mobile =
    (await readVersionFromAppJson(
      path.join(repoRoot, "apps/mobile/app.json")
    )) ??
    (await readVersionFromPackage(
      path.join(repoRoot, "apps/mobile/package.json")
    ));

  return {
    root,
    ...(web ? { web } : {}),
    ...(auth ? { auth } : {}),
    ...(mediaProcessing ? { mediaProcessing } : {}),
    ...(mobile ? { mobile } : {}),
  };
}

async function findMobileArtifact(
  artifactDir: string,
  mobileVersion?: string
): Promise<MobileArtifactInfo | null> {
  try {
    await access(artifactDir);
  } catch {
    return null;
  }

  const files = await readdir(artifactDir);
  const apkFile = files.find((f) => f.endsWith(".apk"));
  if (!apkFile) return null;

  const apkPath = path.join(artifactDir, apkFile);
  const apkBuffer = await readFile(apkPath);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(apkBuffer);
  const sha256 = hasher.digest("hex");

  const sizeMb = (apkBuffer.length / (1024 * 1024)).toFixed(1);

  // Write .sha256 file if not exists
  const shaFilePath = path.join(artifactDir, `${apkFile}.sha256`);
  await writeFile(shaFilePath, `${sha256}  ${apkFile}\n`);

  return {
    fileName: apkFile,
    fileSize: `${sizeMb} MB`,
    sha256,
    version: mobileVersion ?? "0.0.1",
  };
}

export async function generateReleaseNotesFile(
  repoRoot: string,
  artifactDir: string,
  outputFile: string,
  env: Record<string, string | undefined>
): Promise<{
  apkFiles: string[];
  hasApk: boolean;
  notesPath: string;
  releaseTitle: string;
  tagName: string;
}> {
  const versions = await getWorkspaceVersions(repoRoot);
  const mobileArtifact =
    (await findMobileArtifact(artifactDir, versions.mobile)) ?? undefined;

  const prNumberStr = env.PR_NUMBER;
  const prNumber = prNumberStr ? Number(prNumberStr) : undefined;
  const prTitle = env.PR_TITLE;
  const prUrl = env.PR_URL;

  // Commits parsing from env (JSON) or git log fallback
  let commits: ReleaseCommit[] = [];
  if (env.COMMITS_JSON) {
    try {
      commits = JSON.parse(env.COMMITS_JSON) as ReleaseCommit[];
    } catch {
      // ignore
    }
  }

  // Authors parsing
  let authors: string[] = [];
  if (env.AUTHORS_JSON) {
    try {
      authors = JSON.parse(env.AUTHORS_JSON) as string[];
    } catch {
      // ignore
    }
  }

  // If no authors provided, extract from commits
  if (authors.length === 0 && commits.length > 0) {
    authors = [
      ...new Set(commits.map((c) => c.author.replace(/^@/, ""))),
    ].filter(Boolean);
  }

  // Containers parsing
  const containers: ContainerImageInfo[] = [];
  const selectedApps = (env.SELECTED_APPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const appDisplayNames: Record<string, { app: string; image: string }> = {
    auth: {
      app: "Auth Service",
      image: `ghcr.io/${env.GITHUB_REPOSITORY_OWNER || "asocialmedia"}/asm-auth`,
    },
    "media-processing": {
      app: "Media Processing",
      image: `ghcr.io/${env.GITHUB_REPOSITORY_OWNER || "asocialmedia"}/asm-media-processing`,
    },
    web: {
      app: "Web Application",
      image: `ghcr.io/${env.GITHUB_REPOSITORY_OWNER || "asocialmedia"}/asm-web`,
    },
  };

  for (const app of selectedApps) {
    const info = appDisplayNames[app];
    if (info) {
      const appVersion =
        app === "web"
          ? versions.web
          : app === "auth"
            ? versions.auth
            : versions.mediaProcessing;
      containers.push({
        app: info.app,
        image: info.image,
        tag: `${app}-v${appVersion ?? versions.root}`,
      });
    }
  }

  if (env.PRISMA_SYNC_BUILT === "true") {
    containers.push({
      app: "Prisma Sync",
      image: `ghcr.io/${env.GITHUB_REPOSITORY_OWNER || "asocialmedia"}/asm-prisma-sync`,
      tag: `prisma-sync-v${versions.root}`,
    });
  }

  const options: ReleaseNotesOptions = {
    authors,
    commits,
    containers,
    mobileArtifact,
    prNumber,
    prTitle,
    prUrl,
    versions,
  };

  const markdown = formatReleaseNotes(options);
  await writeFile(outputFile, `${markdown}\n`);

  const tagName = `v${versions.root}`;
  const releaseTitle = `v${versions.root}`;

  const apkFiles: string[] = [];
  if (mobileArtifact) {
    apkFiles.push(
      path.join(artifactDir, mobileArtifact.fileName),
      path.join(artifactDir, `${mobileArtifact.fileName}.sha256`)
    );
  }

  return {
    apkFiles,
    hasApk: Boolean(mobileArtifact),
    notesPath: outputFile,
    releaseTitle,
    tagName,
  };
}

// CLI invocation
if (import.meta.main) {
  const repoRoot = process.cwd();
  const artifactDir =
    process.env.ARTIFACT_DIR || path.join(repoRoot, "build-artifacts");
  const outputFile =
    process.env.OUTPUT_FILE || path.join(repoRoot, "release-notes.md");

  const result = await generateReleaseNotesFile(
    repoRoot,
    artifactDir,
    outputFile,
    process.env
  );

  console.log(`Generated release notes at: ${result.notesPath}`);
  console.log(`Tag name: ${result.tagName}`);
  console.log(`Has APK: ${result.hasApk}`);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    const lines = [
      `tag_name=${result.tagName}`,
      `release_title=${result.releaseTitle}`,
      `notes_path=${result.notesPath}`,
      `has_apk=${result.hasApk}`,
      `apk_files=${result.apkFiles.join(",")}`,
    ];
    await writeFile(githubOutput, `${lines.join("\n")}\n`, { flag: "a" });
  }
}
