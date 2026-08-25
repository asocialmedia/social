#!/usr/bin/env bun
// Generates the signing identity the media worker uses to embed C2PA
// "AI Generated" manifests. Mints a local root CA and a leaf signing
// certificate under it - the C2PA SDK's certificate profile rejects plain
// self-signed certs (issuer == subject && isCa), and a real deployment uses
// exactly this CA -> leaf shape anyway.
//
// Usage: bun scripts/generate-c2pa-cert.ts
// Output: .dev-c2pa/{ca.cert.pem, ca.key.pem, cert.pem, key.pem}

import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { $ } from "bun";

const outDir = path.resolve(import.meta.dir, "../.dev-c2pa");
const caCert = path.join(outDir, "ca.cert.pem");
const caKey = path.join(outDir, "ca.key.pem");
const certPath = path.join(outDir, "cert.pem");
const keyPath = path.join(outDir, "key.pem");
const csrPath = path.join(outDir, "signer.csr.pem");

await mkdir(outDir, { recursive: true });

// Dev root CA.
await $`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout ${caKey} -out ${caCert} -days 3650 -nodes \
  -subj "/CN=asm.social provenance dev CA/O=aSocialMedia" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"`;

// Leaf signing identity: end-entity (no CA bit) carrying digitalSignature
// plus BOTH accepted signing EKUs - plain codeSigning alone is rejected by
// the SDK's sign-time allowlist, which wants the C2PA-dedicated EKU
// (1.3.6.1.4.1.62558.2.1) alongside or instead of it.
await $`openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout ${keyPath} -out ${csrPath} -nodes \
  -subj "/CN=asm.social media pipeline (dev)/O=aSocialMedia" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning,1.3.6.1.4.1.62558.2.1"`;

await $`openssl x509 -req -in ${csrPath} \
  -CA ${caCert} -CAkey ${caKey} -CAcreateserial \
  -out ${certPath} -days 1825 -copy_extensions copy`;

// The worker presents the FULL credential chain (leaf + issuing CA); a lone
// end-entity cert fails C2PA chain validation because its issuer cannot be
// resolved.
const chainPath = path.join(outDir, "chain.pem");
await Bun.write(chainPath, [
  await Bun.file(certPath).text(),
  await Bun.file(caCert).text(),
]);

await Promise.all([chmod(certPath, 0o644), chmod(keyPath, 0o600)]);

console.log(`dev C2PA signing pair written:
  ${chainPath}   <- point MEDIA_C2PA_CERT_PATH here
  ${keyPath}     <- point MEDIA_C2PA_KEY_PATH here
  ${caCert}      <- dev trust anchor (for inspectors)

Wire it into the worker (apps/media-processing/.env.development):
  MEDIA_C2PA_CERT_PATH=${chainPath}
  MEDIA_C2PA_KEY_PATH=${keyPath}

Stamps validate structurally; external inspectors treat them as untrusted
until this CA (or its production replacement) is in their trust list.`);
