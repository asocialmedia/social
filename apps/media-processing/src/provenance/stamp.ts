// Embeds our own signed C2PA manifest into assets the scan stage classified
// as AI-generated. The stamp is additive: the upload's original manifest
// chain (Firefly/DALL-E/etc.) is preserved as a parent ingredient, and two
// assertions are layered on top -
//
//   cc.asocialmedia.provenance      platform-private classification record
//   stds.schema-org.CustomMetadata  standards-based "AI Generated" label
//
// The signature makes stripping detectable (the file stops validating) but
// not impossible; Media.aiGenerated in Postgres is the authoritative flag.

import { MEDIA_PIPELINE_VERSION } from "@asm/media";
import { Builder, Reader } from "@contentauth/c2pa-node";

import { workerEnv } from "../env";
import { mediaLogger } from "../log";
import { loadProvenanceSigner } from "./signer";

export interface StampContext {
  // Why the pipeline classified this asset as synthetic.
  detectionReason: string;

  // Content-sniffed MIME of the upload. Required: scan-stage temp files have
  // no extension, so the SDK cannot infer the type and refuses to sign with
  // "Input asset must have a mime type".
  mime: string;
  mediaId: string;
  // Platform provenance mirror. AI-flagged assets are stamped by THIS pass
  // instead of the platform stamp, so the assertion must carry the same
  // platform/uploader identity - otherwise AI media would publish with no
  // embedded attribution at all.
  hashedUploaderId?: string | null;
  uploaderDisplayName?: string | null;
  uploaderUsername?: string | null;
}

export async function stampAiGenerated(
  inputPath: string,
  outputPath: string,
  context: StampContext
): Promise<boolean> {
  const signer = await loadProvenanceSigner();
  if (!signer) {
    return false;
  }

  // Sign-time trust validation is off: this pipeline must accept self-signed
  // development identities, and downstream C2PA inspectors evaluate chains
  // themselves anyway. The manifest signature remains cryptographically
  // verifiable regardless.
  const builder = Builder.new({
    verify: {
      verify_after_reading: false,
      verify_after_sign: false,
      verify_trust: false,
    },
  });

  // Keep whatever provenance chain the upload already had: its manifests
  // become ingredients of ours instead of being discarded.
  try {
    const source = await Reader.fromAsset(
      { mimeType: context.mime, path: inputPath },
      { verify: { verify_after_reading: false, verify_trust: false } }
    );
    if (source?.getActive()) {
      builder.addIngredientFromReader(source);
    }
  } catch {
    // No embedded chain to preserve - fine.
    mediaLogger.debug(
      { mediaId: context.mediaId },
      "no source C2PA chain to preserve while stamping"
    );
  }

  builder.setIntent("edit");

  const flaggedAt = new Date().toISOString();
  // Identity fields derive from NEXT_PUBLIC_URL so dev stamps carry
  // http://localhost:3000 and prod carries the real origin. The custom assertion
  // LABEL stays fixed, though: it names this assertion's schema (reverse-DNS
  // of the production domain) and must not drift between environments.
  const baseUrl = workerEnv.PUBLIC_BASE_URL;
  const siteHost = new URL(baseUrl).hostname.replace(/^www\./u, "");
  // Custom labels use reverse-DNS of our domain per the C2PA spec.
  builder.addAssertion("cc.asocialmedia.provenance", {
    aiGenerated: true,
    detectionReason: context.detectionReason,
    flaggedAt,
    flaggedBy: `${siteHost} media pipeline v${MEDIA_PIPELINE_VERSION}`,
    hashedUploaderId: context.hashedUploaderId ?? null,
    mediaId: context.mediaId,
    platform: "asocialmedia.cc",
    uploaderDisplayName: context.uploaderDisplayName ?? null,
    uploaderUsername: context.uploaderUsername ?? null,
  });
  // The "AI Generated" name doubles as a re-detection hook: a stamped file
  // re-uploaded elsewhere still trips our assertion scanner.
  builder.addAssertion("stds.schema-org.CustomMetadata", {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    additionalType:
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    dateModified: flaggedAt,
    identifier: `${baseUrl}/media/${context.mediaId}`,
    name: "AI Generated",
    publisher: siteHost,
  });

  await builder.sign(
    signer,
    { mimeType: context.mime, path: inputPath },
    { mimeType: context.mime, path: outputPath }
  );
  return true;
}
