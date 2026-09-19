// Points the generated Android release build at a production keystore instead
// of the debug keystore `expo prebuild` writes by default. The keystore and its
// credentials are supplied as Gradle project properties
// (ORG_GRADLE_PROJECT_ASM_UPLOAD_*), so no secret is ever committed.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const gradlePath = fileURLToPath(
  new URL("../android/app/build.gradle", import.meta.url)
);

const RELEASE_SIGNING_CONFIG = `    signingConfigs {
        release {
            if (project.hasProperty('ASM_UPLOAD_STORE_FILE')) {
                storeFile file(ASM_UPLOAD_STORE_FILE)
                storePassword ASM_UPLOAD_STORE_PASSWORD
                keyAlias ASM_UPLOAD_KEY_ALIAS
                keyPassword ASM_UPLOAD_KEY_PASSWORD
            }
            // APK Signature Scheme v3 (Android 9+) is required for key rotation
            // and is what the platform prefers; v2 alone cannot be upgraded to
            // a rotated key later.
            enableV3Signing true
        }
    }
`;

async function main(): Promise<void> {
  let gradle = await readFile(gradlePath, "utf-8");

  if (gradle.includes("signingConfig signingConfigs.release")) {
    console.log("Release signing already configured; nothing to do.");
    return;
  }

  const buildTypesAnchor = "\n    buildTypes {";
  if (!gradle.includes(buildTypesAnchor)) {
    throw new Error(
      "Could not find the buildTypes block in android/app/build.gradle"
    );
  }

  gradle = gradle.replace(
    buildTypesAnchor,
    `\n${RELEASE_SIGNING_CONFIG}    buildTypes {`
  );

  const releaseSigningPattern =
    /(?<prefix>release\s*\{[^}]*?)signingConfig signingConfigs\.debug/su;
  if (!releaseSigningPattern.test(gradle)) {
    throw new Error(
      "Could not find the release buildType signing config in android/app/build.gradle"
    );
  }

  gradle = gradle.replace(
    releaseSigningPattern,
    "$<prefix>signingConfig signingConfigs.release"
  );

  await writeFile(gradlePath, gradle);
  console.log("Configured release signing in android/app/build.gradle");
}

await main();
