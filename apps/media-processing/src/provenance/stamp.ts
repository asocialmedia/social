// Embeds our own signed C2PA manifest into assets the scan stage classified
// as AI-generated. The stamp is additive: the upload's original manifest
// chain (Firefly/DALL-E/etc.) is preserved as a parent ingredient, and two
// assertions are layered on top -
//
//   com.asocialmedia.provenance     platform-private classification record
//   stds.schema-org.CustomMetadata  standards-based "AI Generated" label
//
// The signature makes stripping detectable (the file stops validating) but
// not impossible; Media.aiGenerated in Postgres is the authoritative flag.

import { MEDIA_PIPELINE_VERSION } from "@asm/media";
import { Builder, Reader } from "@contentauth/c2pa-node";

import { mediaLogger } from "../log";
import { loadProvenanceSigner } from "./signer";

export interface StampContext {
  /** Why the pipeline classified this asset as synthetic. */
  detectionReason: string;
  mediaId: string;
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
      { path: inputPath },
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
  builder.addAssertion("com.asocialmedia.provenance", {
    aiGenerated: true,
    detectionReason: context.detectionReason,
    flaggedAt,
    flaggedBy: `asm.social media pipeline v${MEDIA_PIPELINE_VERSION}`,
    mediaId: context.mediaId,
  });
  // The "AI Generated" name doubles as a re-detection hook: a stamped file
  // re-uploaded elsewhere still trips our assertion scanner.
  builder.addAssertion("stds.schema-org.CustomMetadata", {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    additionalType:
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    dateModified: flaggedAt,
    identifier: `asm.social:media:${context.mediaId}`,
    name: "AI Generated",
    publisher: "asm.social",
  });

  await builder.sign(signer, { path: inputPath }, { path: outputPath });
  return true;
}
