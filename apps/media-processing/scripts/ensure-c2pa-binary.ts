// Ensures @contentauth/c2pa-node has the correct native binary (index.node)
// for the target CPU architecture (x86_64 vs aarch64/arm64).
// In Docker multi-arch builds, Bun by default skips postinstall lifecycle scripts,
// and the package tarball ships with an x86_64 ELF binary by default.
// This script checks the ELF machine header of index.node and replaces it with
// the official prebuilt binary for the target architecture if needed.

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable } from "node:stream";
import type { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const require = createRequire(import.meta.url);

const C2PA_VERSION = "0.9.1";
const GITHUB_RELEASE_BASE = `https://github.com/contentauth/c2pa-js/releases/download/%40contentauth%2Fc2pa-node%40${C2PA_VERSION}`;

function resolveTargetPlatform(requested?: string): {
  archName: string;
  elfMachine: number;
  platformKey: string;
} {
  const raw = (requested || process.env.TARGETARCH || process.arch || "")
    .toLowerCase()
    .trim();
  if (raw === "arm64" || raw === "aarch64") {
    return {
      archName: "arm64",
      elfMachine: 0x00_b7, // EM_AARCH64
      platformKey: "aarch64-unknown-linux-gnu",
    };
  }
  return {
    archName: "x64",
    elfMachine: 0x00_3e, // EM_X86_64
    platformKey: "x86_64-unknown-linux-gnu",
  };
}

function findC2paDistDirs(): string[] {
  const candidates = [
    path.resolve(
      import.meta.dir,
      "../../node_modules/@contentauth/c2pa-node/dist"
    ),
    path.resolve(
      import.meta.dir,
      "../../../node_modules/@contentauth/c2pa-node/dist"
    ),
    path.resolve(
      import.meta.dir,
      `../../../node_modules/.bun/@contentauth+c2pa-node@${C2PA_VERSION}/node_modules/@contentauth/c2pa-node/dist`
    ),
    "/app/node_modules/@contentauth/c2pa-node/dist",
    "/app/apps/media-processing/node_modules/@contentauth/c2pa-node/dist",
  ];

  const found = new Set<string>();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const real = fs.realpathSync(candidate);
        found.add(real);
      } catch {
        found.add(candidate);
      }
    }
  }
  return [...found];
}

function readElfMachine(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(20);
    fs.readSync(fd, buf, 0, 20, 0);
    fs.closeSync(fd);

    if (
      buf[0] === 0x7f &&
      buf[1] === 0x45 &&
      buf[2] === 0x4c &&
      buf[3] === 0x46
    ) {
      return buf[18] | (buf[19] << 8);
    }
  } catch {
    return null;
  }
  return null;
}

function loadUnzipper(): { ParseOne: () => Transform } {
  const unzipperCandidates = [
    path.resolve(
      import.meta.dir,
      `../../../node_modules/.bun/@contentauth+c2pa-node@${C2PA_VERSION}/node_modules/unzipper`
    ),
    path.resolve(
      import.meta.dir,
      "../../node_modules/@contentauth/c2pa-node/node_modules/unzipper"
    ),
    "unzipper",
  ];

  for (const candidate of unzipperCandidates) {
    try {
      return require(candidate);
    } catch {
      // try next
    }
  }
  throw new Error(
    "Could not load 'unzipper' dependency from @contentauth/c2pa-node"
  );
}

async function main() {
  const target = resolveTargetPlatform(process.argv[2]);
  console.log(
    `[c2pa-binary] Target architecture: ${target.archName} (${target.platformKey})`
  );

  const distDirs = findC2paDistDirs();
  if (distDirs.length === 0) {
    console.warn(
      "[c2pa-binary] Warning: No c2pa-node dist directories found; skipping."
    );
    return;
  }

  let needsDownload = false;
  for (const dir of distDirs) {
    const binaryPath = path.join(dir, "index.node");
    const currentMachine = readElfMachine(binaryPath);
    if (currentMachine === target.elfMachine) {
      console.log(
        `[c2pa-binary] ${binaryPath} already matches machine 0x${target.elfMachine.toString(16)}`
      );
    } else {
      console.log(
        `[c2pa-binary] Architecture mismatch in ${binaryPath}: current 0x${(currentMachine ?? 0).toString(16)}, expected 0x${target.elfMachine.toString(16)}`
      );
      needsDownload = true;
    }
  }

  if (!needsDownload) {
    console.log("[c2pa-binary] All c2pa-node binaries are up to date.");
    return;
  }

  const zipUrl = `${GITHUB_RELEASE_BASE}/c2pa-node_${target.platformKey}-v${C2PA_VERSION}.zip`;
  console.log(`[c2pa-binary] Downloading ${zipUrl}...`);

  const resp = await fetch(zipUrl);
  if (!resp.ok) {
    throw new Error(
      `Failed to download ${zipUrl}: HTTP ${resp.status} ${resp.statusText}`
    );
  }

  if (!resp.body) {
    throw new Error(`Response body is empty for ${zipUrl}`);
  }

  const tempOut = path.join(
    "/tmp",
    `c2pa-${target.platformKey}-${Date.now()}-index.node`
  );

  const unzipper = loadUnzipper();
  const nodeStream = Readable.fromWeb(
    resp.body as unknown as Parameters<typeof Readable.fromWeb>[0]
  );

  await pipeline(
    nodeStream,
    unzipper.ParseOne(),
    fs.createWriteStream(tempOut)
  );

  const downloadedMachine = readElfMachine(tempOut);
  if (downloadedMachine !== target.elfMachine) {
    fs.unlinkSync(tempOut);
    throw new Error(
      `Downloaded binary machine 0x${(downloadedMachine ?? 0).toString(16)} does not match expected 0x${target.elfMachine.toString(16)}`
    );
  }

  for (const dir of distDirs) {
    fs.mkdirSync(dir, { recursive: true });
    const targetFile = path.join(dir, "index.node");
    fs.copyFileSync(tempOut, targetFile);
    console.log(`[c2pa-binary] Successfully updated ${targetFile}`);
  }

  try {
    fs.unlinkSync(tempOut);
  } catch {
    // ignore
  }

  console.log(
    "[c2pa-binary] Verified and installed c2pa-node binary successfully."
  );
}

try {
  await main();
} catch (error) {
  console.error("[c2pa-binary] Error:", error);
  process.exit(1);
}
