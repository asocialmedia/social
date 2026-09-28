// Builds a signed Android release APK, both locally and in CI.
//
// Credentials are resolved from the environment first, then from the local
// gitignored android-signing/ folder, so the same code path runs in both
// places:
//   ANDROID_KEYSTORE_BASE64   base64 of the .keystore (CI only; local uses the file)
//   ANDROID_KEYSTORE_PASSWORD store password
//   ANDROID_KEY_ALIAS         key alias
//   ANDROID_KEY_PASSWORD      key password, JKS only (ignored for PKCS12)
//
// Both keystore formats are supported:
//   PKCS12 - carries a single password, so the key password is always the store
//            password. keytool silently discards a distinct -keypass at
//            creation, and supplying one at build time yields an undecryptable
//            key (`Given final block not properly padded`).
//   JKS    - may carry a key password distinct from the store password; it is
//            read from ANDROID_KEY_PASSWORD/keypass.txt and verified up front.
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { $ } from "bun";

import {
  ANDROID_SPLIT_ABIS,
  isAndroidSplitAbi,
} from "../plugins/with-android-abi-splits";
import {
  googleServicesCandidates,
  pickFirstExisting,
  validateGoogleServices,
} from "./google-services-lib";
import {
  describeMissingReleaseApk,
  resolveReleaseApk,
} from "./release-apk-lib";

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url))
);
const SIGNING_DIR = path.join(repoRoot, "android-signing");
const MOBILE_DIR = path.join(repoRoot, "apps", "mobile");
const ANDROID_DIR = path.join(MOBILE_DIR, "android");
const APP_DIR = path.join(ANDROID_DIR, "app");
const ARTIFACT_DIR = path.join(repoRoot, "build-artifacts");

// Where app.json's android.googleServicesFile points (relative to apps/mobile),
// and therefore where the file must sit before `expo prebuild` runs: the Google
// Services config plugin copies it into android/app/ and reads it during the
// same prebuild pass.
const GOOGLE_SERVICES_FILE = path.join(MOBILE_DIR, "google-services.json");
// Local dev convenience: the file may live at the repo root instead (gitignored
// either way). CI supplies it as a base64 secret, so neither is committed.
const ROOT_GOOGLE_SERVICES_FILE = path.join(repoRoot, "google-services.json");

// shipping APKs carry arm64-v8a; the other ABIs are emulator-only (x86/x86_64)
// or 32-bit legacy, and together account for ~62 MB nobody downloads.
const DEFAULT_ABI = "arm64-v8a";

// assembleRelease writes one APK per ABI here, and - because the split sets
// `universalApk false` - no plain app-release.apk alongside them.
const APK_OUTPUT_DIR = path.join(APP_DIR, "build", "outputs", "apk", "release");

// bundleRelease writes the single, universal Android App Bundle here.
const BUNDLE_OUTPUT_DIR = path.join(
  APP_DIR,
  "build",
  "outputs",
  "bundle",
  "release"
);
const BUNDLE_FILE_NAME = "app-release.aab";

type BuildMode = "apk" | "bundle" | "all";

function resolveBuildMode(): BuildMode {
  const flags = new Set(process.argv.slice(2));
  if (flags.has("--all")) {
    return "all";
  }
  if (flags.has("--bundle") || flags.has("--aab")) {
    return "bundle";
  }
  if (flags.has("--apk")) {
    return "apk";
  }
  return "apk";
}

// The Expo template's generated gradle.properties caps the build daemon at
// 2 GiB of heap and 512 MiB of metaspace, and a release build with the ABI
// split outgrows both: Gradle reported "running out of JVM Metaspace" part-way
// through the build, and :app:packageRelease then failed with "Java heap space"
// from PackageAndroidArtifact's splitter, which holds the whole native lib tree
// once per split.
//
// Passed on the command line rather than written into gradle.properties, because
// `expo prebuild --clean` regenerates that file and would discard the edit.
const GRADLE_JVM_ARGS = "-Xmx4g -XX:MaxMetaspaceSize=1g";

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

interface ResolvedGoogleServices {
  content: string;
  // Where the config came from, for the build log.
  source: string;
}

// Resolves google-services.json for the build. Resolution order, first match
// wins:
//   1. GOOGLE_SERVICES_JSON_BASE64 - the CI secret (the file is gitignored).
//   2. GOOGLE_SERVICES_JSON        - explicit path override.
//   3. apps/mobile/google-services.json - already provisioned by a past build.
//   4. <repo>/google-services.json - local dev convenience.
//
// Unlike the keystore this is not a credential - it holds public-facing
// Firebase identifiers - so the copy written into apps/mobile is left in place
// for the next prebuild rather than cleaned up like the signing key.
async function resolveGoogleServices(): Promise<ResolvedGoogleServices> {
  const base64 = process.env.GOOGLE_SERVICES_JSON_BASE64?.trim();
  if (base64) {
    return {
      content: Buffer.from(base64, "base64").toString("utf-8"),
      source: "GOOGLE_SERVICES_JSON_BASE64",
    };
  }

  const candidates = googleServicesCandidates({
    explicitPath: process.env.GOOGLE_SERVICES_JSON?.trim() || null,
    mobileFile: GOOGLE_SERVICES_FILE,
    rootFile: ROOT_GOOGLE_SERVICES_FILE,
  });
  // Read every candidate up front (concurrently), then pick the first that
  // existed, preserving the documented precedence.
  const contents = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return await readFile(candidate.path, "utf-8");
      } catch {
        return null;
      }
    })
  );
  const resolved = pickFirstExisting(candidates, contents);
  if (!resolved) {
    fail(
      "Missing google-services.json. Set GOOGLE_SERVICES_JSON_BASE64 (CI), set GOOGLE_SERVICES_JSON to a path, or place the file at the repo root."
    );
  }
  return resolved;
}

// Rejects a config that would register the wrong application. Firebase mints no
// token for a package it does not know, so a mismatch ships an APK whose push
// is silently dead - fail the build instead.
function assertGoogleServices(content: string, source: string): void {
  const verdict = validateGoogleServices(content);
  if (!verdict.ok) {
    fail(`google-services.json from ${source} ${verdict.error}.`);
  }
}

interface ResolvedKeystore {
  cleanup: () => Promise<void>;
  keyAlias: string;
  keyPassword: string;
  // Where the keystore lives now; copied into android/app/ after prebuild.
  sourcePath: string;
  storePassword: string;
}

// Resolves the keystore to a file outside the native project.
//
// It deliberately does NOT write into android/app/ yet: `expo prebuild --clean`
// deletes and regenerates that whole directory, so anything placed there before
// prebuild is wiped. `provisionKeystore` copies it in afterwards.
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
  const cleanup = () => rm(scratch, { force: true, recursive: true });
  try {
    const decoded = path.join(scratch, "release.keystore");
    await writeFile(decoded, Buffer.from(base64, "base64"));
    return { cleanup, path: decoded };
  } catch (error) {
    // Never leave a decoded production keystore behind.
    await cleanup();
    throw error;
  }
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

// Proves a JKS key can actually be decrypted with the given key password.
//
// Only meaningful for JKS: `keytool` ignores `-srckeypass` for PKCS12 (it warns
// and falls back to the store password), so a PKCS12 probe always succeeds.
// Gradle otherwise only reports a bad key password as
// `KeytoolException: ... Given final block not properly padded` after a full
// ~3 minute build, so fail fast here instead.
async function assertKeyReadable(
  keystorePath: string,
  storePassword: string,
  keyPassword: string,
  keyAlias: string
): Promise<void> {
  const scratch = await mkdtemp(path.join(tmpdir(), "asm-key-probe-"));
  const probe = path.join(scratch, "probe.jks");
  try {
    const result =
      await $`keytool -importkeystore -srckeystore ${keystorePath} -srcstorepass ${storePassword} -srcalias ${keyAlias} -srckeypass ${keyPassword} -destkeystore ${probe} -deststoretype jks -deststorepass probe-password -destkeypass probe-password`
        .nothrow()
        .quiet();
    if (result.exitCode !== 0) {
      fail(
        `The keystore's private key cannot be decrypted with the configured credentials.\n\n${result.stderr.toString().trim()}`
      );
    }
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

async function resolveKeystore(): Promise<ResolvedKeystore> {
  const storePassword =
    process.env.ANDROID_KEYSTORE_PASSWORD?.trim() ??
    (await readCredentialFile("storepass.txt"));
  const keyAlias =
    process.env.ANDROID_KEY_ALIAS?.trim() ??
    (await readCredentialFile("alias.txt"));
  // Only meaningful for JKS; PKCS12 has no second password to supply.
  // An empty value (an unset CI secret resolves to "") means "not provided",
  // not "the key password is the empty string", so it must fall through to the
  // file and then to the store password rather than being used as-is.
  const envKeyPassword = process.env.ANDROID_KEY_PASSWORD?.trim() || null;
  const explicitKeyPassword =
    envKeyPassword ?? (await readCredentialFile("keypass.txt"));

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

  try {
    const type = await keystoreType(sourcePath, storePassword);
    const normalizedType = type.toUpperCase();

    let keyPassword: string;
    if (normalizedType === "PKCS12") {
      // A PKCS12 keystore carries a single password, and keytool silently
      // ignores any distinct -keypass supplied at creation. The store password
      // is the only value that can open the key, so a separate key password is
      // not just unnecessary here - using one produces an undecryptable key.
      keyPassword = storePassword;
      if (explicitKeyPassword && explicitKeyPassword !== storePassword) {
        console.warn(
          "ANDROID_KEY_PASSWORD differs from the store password, but this PKCS12 keystore has a single password; using the store password."
        );
      }
      console.log(
        "Keystore type: PKCS12 - using the store password as the key password."
      );
    } else if (normalizedType === "JKS") {
      // JKS can carry a key password distinct from the store password.
      keyPassword = explicitKeyPassword ?? storePassword;
      await assertKeyReadable(sourcePath, storePassword, keyPassword, keyAlias);
      console.log("Keystore type: JKS - key password verified.");
    } else {
      fail(`Unsupported keystore type ${type}; expected PKCS12 or JKS.`);
    }

    return { cleanup, keyAlias, keyPassword, sourcePath, storePassword };
  } catch (error) {
    // Any validation failure must not strand a decoded production keystore in
    // the scratch directory.
    await cleanup();
    throw error;
  }
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

async function assertTooling(mode: BuildMode): Promise<void> {
  if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)) {
    fail("ANDROID_HOME (or ANDROID_SDK_ROOT) must point at an Android SDK.");
  }
  await $`java -version`.quiet();
  if (mode === "bundle" || mode === "all") {
    await $`jarsigner -help`.quiet();
  }
}

// The ABI the release APK is built for. Validated up front: an ABI the split
// does not produce yields no artifact, and the build is minutes long.
function resolveAbi(): string {
  const abi = process.env.ASM_ANDROID_ABI ?? DEFAULT_ABI;
  if (!isAndroidSplitAbi(abi)) {
    fail(
      `ASM_ANDROID_ABI is "${abi}", which the release split does not produce. Use one of: ${ANDROID_SPLIT_ABIS.join(", ")}.`
    );
  }
  return abi;
}

async function main(): Promise<void> {
  const mode = resolveBuildMode();
  await assertTooling(mode);
  const abi = resolveAbi();
  const { cleanup, keyAlias, keyPassword, sourcePath, storePassword } =
    await resolveKeystore();

  try {
    // Must run BEFORE prebuild: the Google Services config plugin copies the
    // file into android/app/ and wires the Gradle plugin during the same
    // prebuild pass, and app.config.ts only declares googleServicesFile when
    // the file is present.
    step("Provisioning google-services.json");
    const googleServices = await resolveGoogleServices();
    assertGoogleServices(googleServices.content, googleServices.source);
    await writeFile(GOOGLE_SERVICES_FILE, googleServices.content);
    console.log(`Source: ${googleServices.source}`);

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

    const packageJson = JSON.parse(
      await readFile(path.join(MOBILE_DIR, "package.json"), "utf-8")
    ) as { version?: string };
    const version = packageJson.version ?? "0.0.0";
    await mkdir(ARTIFACT_DIR, { recursive: true });

    const gradleEnv = {
      ...process.env,
      ORG_GRADLE_PROJECT_ASM_UPLOAD_KEY_ALIAS: keyAlias,
      ORG_GRADLE_PROJECT_ASM_UPLOAD_KEY_PASSWORD: keyPassword,
      ORG_GRADLE_PROJECT_ASM_UPLOAD_STORE_FILE: "release.keystore",
      ORG_GRADLE_PROJECT_ASM_UPLOAD_STORE_PASSWORD: storePassword,
    };

    if (mode === "bundle" || mode === "all") {
      step("Building release App Bundle (.aab) (this takes a while)");
      await $`./gradlew bundleRelease --no-daemon -Dorg.gradle.jvmargs=${GRADLE_JVM_ARGS}`
        .cwd(ANDROID_DIR)
        .env(gradleEnv);

      const bundleSource = path.join(BUNDLE_OUTPUT_DIR, BUNDLE_FILE_NAME);
      await access(bundleSource).catch(() => {
        fail(`Expected AAB bundle not found at ${bundleSource}`);
      });

      step("Verifying AAB signature");
      await $`jarsigner -verify ${bundleSource}`;

      const aabName = `asocialmedia-v${version}.aab`;
      step("Packaging AAB artifact");
      const aabDestination = path.join(ARTIFACT_DIR, aabName);
      await copyFile(bundleSource, aabDestination);
      const aabSha = new Bun.CryptoHasher("sha256");
      aabSha.update(await readFile(aabDestination));
      const aabDigest = aabSha.digest("hex");
      await Bun.write(`${aabDestination}.sha256`, `${aabDigest}  ${aabName}\n`);

      console.log(`AAB:      ${aabDestination}`);
      console.log(`SHA-256:  ${aabDigest}`);
    }

    if (mode === "apk" || mode === "all") {
      step(`Building release APK for ${abi} (this takes a while)`);
      await $`./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=${abi} -Dorg.gradle.jvmargs=${GRADLE_JVM_ARGS}`
        .cwd(ANDROID_DIR)
        .env(gradleEnv);

      // The split names the artifact per ABI, so the requested one has to be
      // selected out of the output directory rather than assumed. An unreadable
      // directory is reported as an empty one, so the failure names the file it
      // wanted rather than a bare ENOENT.
      const built = resolveReleaseApk({
        abi,
        files: await readdir(APK_OUTPUT_DIR).catch(() => []),
      });
      if (built.kind === "missing") {
        fail(describeMissingReleaseApk(built, APK_OUTPUT_DIR));
      }
      const apkSource = path.join(APK_OUTPUT_DIR, built.fileName);
      await access(apkSource).catch(() => {
        fail(`Expected APK not found at ${apkSource}`);
      });

      step("Verifying APK signature");
      await $`${findApksigner()} verify --print-certs ${apkSource}`;

      const apkName = `asocialmedia-v${version}.apk`;
      step("Packaging APK artifact");
      const destination = path.join(ARTIFACT_DIR, apkName);
      await copyFile(apkSource, destination);
      const sha = new Bun.CryptoHasher("sha256");
      sha.update(await readFile(destination));
      const digest = sha.digest("hex");
      await Bun.write(`${destination}.sha256`, `${digest}  ${apkName}\n`);

      console.log(`APK:      ${destination}`);
      console.log(`SHA-256:  ${digest}`);
    }

    step("Done");
    console.log(`Version:  v${version}`);
    if (mode === "apk" || mode === "all") {
      console.log(
        `\nInstall APK with: adb install -r "${path.join(ARTIFACT_DIR, `asocialmedia-v${version}.apk`)}"`
      );
    }
    if (mode === "bundle" || mode === "all") {
      console.log(
        `Upload AAB to Play Console: ${path.join(ARTIFACT_DIR, `asocialmedia-v${version}.aab`)}`
      );
    }
  } finally {
    // Remove every provisioned copy of the production keystore, on success and
    // failure alike: the scratch dir the CI secret was decoded into, and the
    // copy the Gradle build signed with.
    await cleanup();
    await rm(path.join(APP_DIR, "release.keystore"), { force: true });
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nBuild failed: ${message}`);
    process.exitCode = 1;
  });
}
