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
  keyPassword: string;
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

/**
 * Proves a JKS key can actually be decrypted with the given key password.
 *
 * Only meaningful for JKS: `keytool` ignores `-srckeypass` for PKCS12 (it warns
 * and falls back to the store password), so a PKCS12 probe always succeeds.
 * Gradle otherwise only reports a bad key password as
 * `KeytoolException: ... Given final block not properly padded` after a full
 * ~3 minute build, so fail fast here instead.
 */
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

async function assertTooling(): Promise<void> {
  if (!(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)) {
    fail("ANDROID_HOME (or ANDROID_SDK_ROOT) must point at an Android SDK.");
  }
  await $`java -version`.quiet();
}

async function main(): Promise<void> {
  await assertTooling();
  const { cleanup, keyAlias, keyPassword, sourcePath, storePassword } =
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
        ORG_GRADLE_PROJECT_ASM_UPLOAD_KEY_PASSWORD: keyPassword,
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
