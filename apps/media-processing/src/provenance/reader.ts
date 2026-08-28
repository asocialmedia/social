// C2PA manifest reading. Wraps @contentauth/c2pa-node's Reader so the scan
// stage can classify an upload's embedded provenance. Reading is strictly
// best-effort: any failure resolves to null so provenance inspection can
// never block or fail an upload.

import type { AiProvenanceVerdict } from "@asm/media";
import { detectAiFromManifestStore } from "@asm/media";
import { Reader } from "@contentauth/c2pa-node";

import { mediaLogger } from "../log";

export interface AssetProvenance {
  claimGenerator: string | null;
  // True when the SDK validated signatures against its trust list.
  signatureTrusted: boolean;
  verdict: AiProvenanceVerdict;
}

export async function inspectAssetProvenance(
  filePath: string,
  mime: string
): Promise<AssetProvenance | null> {
  let reader: Reader | null = null;
  try {
    reader = await Reader.fromAsset(
      { mimeType: mime, path: filePath },
      // We classify structure, not trust chains: uploads signed by unknown
      // generators must still yield their manifests for classification.
      { verify: { verify_after_reading: false, verify_trust: false } }
    );
  } catch {
    // No manifest (or unreadable container) - the overwhelmingly common case
    // for camera photos. Debug level keeps scan logs quiet.
    mediaLogger.debug({ filePath }, "asset carries no readable C2PA data");
    return null;
  }
  if (!reader) {
    return null;
  }

  const active = reader.getActive();
  if (!active) {
    return null;
  }

  const verdict = detectAiFromManifestStore(reader.json());
  return {
    claimGenerator: active.claim_generator_info?.[0]?.name ?? null,
    signatureTrusted: false,
    verdict,
  };
}
