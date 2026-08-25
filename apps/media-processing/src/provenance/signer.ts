// Signing credentials for provenance stamps. Mirrors the CLAMAV_HOST
// contract: unset paths mean stamping is disabled (detection still records
// DB-side), configured-but-unreadable paths fail loudly instead of silently
// publishing unstamped AI-flagged media.

import { readFile } from "node:fs/promises";

import { LocalSigner } from "@contentauth/c2pa-node";

import { workerEnv } from "../env";
import { mediaLogger } from "../log";

let cached: Promise<LocalSigner> | null = null;

/**
 * Returns a signer for embedding our AI-generation manifests, or null when
 * no signing identity is configured (MEDIA_C2PA_CERT_PATH / _KEY_PATH).
 */
export async function loadProvenanceSigner(): Promise<LocalSigner | null> {
  const certPath = workerEnv.C2PA_CERT_PATH;
  const keyPath = workerEnv.C2PA_KEY_PATH;
  if (!certPath || !keyPath) {
    return null;
  }

  cached ??= (async () => {
    const [certificate, privateKey] = await Promise.all([
      readFile(certPath),
      readFile(keyPath),
    ]);
    // The optional RFC 3161 TSA keeps signatures verifiable after the cert
    // expires - essential for short-lived (e.g. free-tier) credentials.
    return LocalSigner.newSigner(
      certificate,
      privateKey,
      "es256",
      workerEnv.C2PA_TSA_URL
    );
  })();

  try {
    return await cached;
  } catch (error) {
    // Reset so a fixed configuration is picked up on the next job instead
    // of caching the failure forever.
    cached = null;
    mediaLogger.error(
      { error: String(error) },
      "provenance signing identity failed to load"
    );
    throw error;
  }
}

/** Test seam: drop the memoized signer between isolation-isolated tests. */
export function resetProvenanceSignerCache(): void {
  cached = null;
}
