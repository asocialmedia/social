// Builds a signed Android release APK, both locally and in CI.
//
// Credentials are resolved from the environment first, then from the local
// gitignored android-signing/ folder, so the same code path runs in both
// places:
//   ANDROID_KEYSTORE_BASE64   base64 of the .keystore (CI only; local uses the file)
//   ANDROID_KEYSTORE_PASSWORD store password
//   ANDROID_KEY_ALIAS         key alias
//
// The keystore is PKCS12, which carries a single password, so the key password
// is always the store password. Supplying a distinct key password is impossible
// on PKCS12 and silently produces an undecryptable key.
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { $ } from "bun";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url))
);
const SIGNING_DIR = path.join(repoRoot, "android-signing");
const MOBILE_DIR = path.join(repoRoot, "apps", "mobile");
const ANDROID_DIR = path.join(MOBILE_DIR, "android");
const APP_DIR = path.join(ANDROID_DIR, "app");
const ARTIFACT_DIR = path.join(repoRoot, "build-artifacts");

// shipping APKs carry arm64-v8a; the other ABIs are emulator-only (x86/x86_64)
// or 32-bit legacy, and together account for ~62 MB nobody downloads.
const DEFAULT_ABI = "arm64-v8a";

function step(message: string): void {
  console.log(`\n\u001B[1m==> ${message}\u001B[0m`);
}

function fail(message: string): never {
  throw new Error(message);
}

async function readCredentialFile(name: string): Promise<string | null> {
  try {
    const contents = await readFile(path.join(SIGNING_DIR, name), "utf-8");
    return contents.trim() || null;
  } catch {
    return null;
  }
}

interface ResolvedKeystore {
  cleanup: () => Promise<void>;
  keyAlias: string;
  /** Where the keystore lives now; copied into android/app/ after prebuild. */
  sourcePath: string;
  storePassword: string;
}

/**
 * Resolves the keystore to a file outside the native project.
 *
 * It deliberately does NOT write into android/app/ yet: `expo prebuild --clean`
 * deletes and regenerates that whole directory, so anything placed there before
 * prebuild is wiped. `provisionKeystore` copies it in afterwards.
 */
async function resolveKeystorePath(): Promise<{
  cleanup: () => Promise<void>;
  path: string;
}> {
  const base64 = process.env.ANDROID_KEYSTORE_BASE64?.trim();
  if (!base64) {
    const localPath = path.join(SIGNING_DIR, "release.keystore");
    await access(localPath).catch(() => {
      fail(
        `No keystore available. Set ANDROID_KEYSTORE_BASE64, or place a release.keystore in ${path.relative(repoRoot, SIGNING_DIR)}/.`
      );
    });
    return { cleanup: () => Promise.resolve(), path: localPath };
  }

  const scratch = await mkdtemp(path.join(tmpdir(), "asm-android-keystore-"));
  const decoded = path.join(scratch, "release.keystore");
  await writeFile(decoded, Buffer.from(base64, "base64"));
  return {
    cleanup: () => rm(scratch, { force: true, recursive: true }),
    path: decoded,
  };
}

async function keystoreType(
  keystorePath: string,
  storePassword: string
): Promise<string> {
  const result =
    await $`keytool -list -keystore ${keystorePath} -storepass ${storePassword}`
      .nothrow()
      .quiet();
  const match = result.stdout
    .toString()
    .match(/Keystore type:\s*(?<type>\S+)/u);
  if (result.exitCode !== 0 || !match?.[1]) {
    fail(
      `Could not read the keystore with ANDROID_KEYSTORE_PASSWORD:\n${result.stderr.toString().trim()}`
    );
  }
  return match[1];
}

async function resolveKeystore(): Promise<ResolvedKeystore> {
  const storePassword =
    process.env.ANDROID_KEYSTORE_PASSWORD?.trim() ??
    (await readCredentialFile("storepass.txt"));
  const keyAlias =
    process.env.ANDROID_KEY_ALIAS?.trim() ??
    (await readCredentialFile("alias.txt"));

  if (!storePassword) {
    fail(
      "Missing store password. Set ANDROID_KEYSTORE_PASSWORD or android-signing/storepass.txt."
    );
  }
  if (!keyAlias) {
    fail(
      "Missing key alias. Set ANDROID_KEY_ALIAS or android-signing/alias.txt."
    );
  }

  step("Verifying signing credentials");
  const { cleanup, path: sourcePath } = await resolveKeystorePath();
  const type = await keystoreType(sourcePath, storePassword);

  if (type.toUpperCase() !== "PKCS12") {
    // JKS allows a distinct key password; PKCS12 does not. Nothing in this repo
    // uses JKS, so refusing avoids silently signing with the wrong key.
    await cleanup();
    fail(
      `Unexpected keystore type ${type}; this build expects a PKCS12 keystore.`
    );
  }
  console.log(
    "Keystore type: PKCS12 - using the store password as the key password."
  );

  return { cleanup, keyAlias, sourcePath, storePassword };
}

function findApksigner(): string {
  const buildTools = path.join(
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "",
    "build-tools"
  );
  const found = new Bun.Glob("*/apksigner").scanSync({ cwd: buildTools });
  const apksignerPath = [...found]
    .map((relative) => ({
      relative,
      version: path.dirname(relative).split(".").map(Number),
    }))
    .toSorted((a, b) => {
      for (let i = 0; i < 3; i += 1) {
        const diff = (a.version[i] ?? 0) - (b.version[i] ?? 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return 0;
    })
    .at(-1)?.relative;
  if (!apksignerPath) {
    fail(`Could not find apksigner under ${buildTools}`);
  }
  return path.join(buildTools, apksignerPath);
}

async function assertTooling(): Promise<void> {
  if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)) {
    fail("ANDROID_HOME (or ANDROID_SDK_ROOT) must point at an Android SDK.");
  }
  await $`java -version`.quiet();
}

async function main(): Promise<void> {
  await assertTooling();
  const { cleanup, keyAlias, sourcePath, storePassword } =
    await resolveKeystore();
  const abi = process.env.ASM_ANDROID_ABI ?? DEFAULT_ABI;

  try {
    step("Generating native Android project");
    await $`bunx expo prebuild --platform android --no-install --clean`.cwd(
      MOBILE_DIR
    );

    step("Configuring release signing");
    await $`bun apps/mobile/scripts/configure-android-release-signing.ts`.cwd(
      repoRoot
    );

    // Only now, after prebuild has regenerated android/, is it safe to place the
    // keystore: prebuild --clean deletes the directory.
    step("Provisioning release keystore");
    await copyFile(sourcePath, path.join(APP_DIR, "release.keystore"));

    step(`Building release APK for ${abi} (this takes a while)`);
    await $`./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=${abi}`
      .cwd(ANDROID_DIR)
      .env({
        ...process.env,
        ORG_GRADLE_PROJECT_ASM_UPLOAD_KEY_ALIAS: keyAlias,
        ORG_GRADLE_PROJECT_ASM_UPLOAD_KEY_PASSWORD: storePassword,
        ORG_GRADLE_PROJECT_ASM_UPLOAD_STORE_FILE: "release.keystore",
        ORG_GRADLE_PROJECT_ASM_UPLOAD_STORE_PASSWORD: storePassword,
      });

    const apkSource = path.join(
      APP_DIR,
      "build",
      "outputs",
      "apk",
      "release",
      "app-release.apk"
    );
    await access(apkSource).catch(() => {
      fail(`Expected APK not found at ${apkSource}`);
    });

    step("Verifying APK signature");
    await $`${findApksigner()} verify --print-certs ${apkSource}`;

    const packageJson = JSON.parse(
      await readFile(path.join(MOBILE_DIR, "package.json"), "utf-8")
    ) as { version?: string };
    const version = packageJson.version ?? "0.0.0";
    const apkName = `asocialmedia-v${version}.apk`;

    step("Packaging artifact");
    await mkdir(ARTIFACT_DIR, { recursive: true });
    const destination = path.join(ARTIFACT_DIR, apkName);
    await copyFile(apkSource, destination);
    const sha = new Bun.CryptoHasher("sha256");
    sha.update(await readFile(destination));
    const digest = sha.digest("hex");
    await Bun.write(`${destination}.sha256`, `${digest}  ${apkName}\n`);

    step("Done");
    console.log(`APK:      ${destination}`);
    console.log(`SHA-256:  ${digest}`);
    console.log(`Version:  v${version}`);
    console.log(`\nInstall with: adb install -r "${destination}"`);
  } finally {
    // Removes the scratch dir the CI keystore was decoded into.
    await cleanup();
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nBuild failed: ${message}`);
    process.exitCode = 1;
  });
}
