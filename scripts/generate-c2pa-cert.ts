#!/usr/bin/env bun
// Generates the self-signed ES256 (P-256) signing pair the media worker uses
// to embed C2PA "AI Generated" manifests in development. Production must use
// a certificate issued under a real trusted chain instead.
//
// Usage: bun scripts/generate-c2pa-cert.ts
// Output: .dev-c2pa/cert.pem + .dev-c2pa/key.pem

import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { $ } from "bun";

const outDir = path.resolve(import.meta.dir, "../.dev-c2pa");
const certPath = path.join(outDir, "cert.pem");
const keyPath = path.join(outDir, "key.pem");

await mkdir(outDir, { recursive: true });

// C2PA requires the code-signing EKU; -nodes keeps the key unencrypted since
// the worker has no passphrase plumbing. Overwrites any previous dev pair.
await $`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout ${keyPath} -out ${certPath} -days 3650 -nodes \
  -subj "/CN=asm.social provenance (dev)/O=aSocialMedia/C=IN" \
  -addext "extendedKeyUsage=critical,codeSigning"`;

await Promise.all([chmod(certPath, 0o644), chmod(keyPath, 0o600)]);

console.log(`dev C2PA signing pair written:
  ${certPath}
  ${keyPath}

Wire it into the worker (apps/media-processing/.env.development):
  MEDIA_C2PA_CERT_PATH=${certPath}
  MEDIA_C2PA_KEY_PATH=${keyPath}

Note: self-signed stamps validate structurally but show as "untrusted" in
C2PA inspectors - expected outside production.`);
