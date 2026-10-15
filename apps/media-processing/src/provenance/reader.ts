// C2PA manifest reading. Wraps @contentauth/c2pa-node's Reader so the scan
// stage can classify an upload's embedded provenance. Reading is strictly
// best-effort: any failure resolves to null so provenance inspection can
// never block or fail an upload.

import type { AiProvenanceVerdict } from "@asm/media";
import {
  detectAiFromManifestStore,
  detectAiFromXmp,
  readMediaIdentityXmp,
} from "@asm/media";
import { Reader } from "@contentauth/c2pa-node";
import sharp from "sharp";

import { mediaLogger } from "../log";

export interface AssetProvenance {
  sourceMediaId?: string | null;
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
  let xmpVerdict = detectAiFromXmp();
  let sourceMediaId: string | null = null;
  if (mime.startsWith("image/")) {
    try {
      const metadata = await sharp(filePath, {
        limitInputPixels: 100_000_000,
      }).metadata();
      xmpVerdict = detectAiFromXmp(metadata.xmp?.toString());
      sourceMediaId = readMediaIdentityXmp(metadata.xmp?.toString());
    } catch {
      // Unsupported image containers can still carry a C2PA manifest.
    }
  }
  const xmpResult =
    xmpVerdict.aiGenerated || sourceMediaId
      ? {
          claimGenerator: null,
          signatureTrusted: false,
          sourceMediaId,
          verdict: xmpVerdict,
        }
      : null;
  try {
    reader = await Reader.fromAsset(
      { mimeType: mime, path: filePath },
      // We classify structure, not trust chains: uploads signed by unknown
      // generators must still yield their manifests for classification.
      { verify: { verify_after_reading: false, verify_trust: false } }
    );
  } catch (error) {
    // No manifest (or unsupported type) - the overwhelmingly common case
    // for standard photos and assets without provenance. Debug level keeps scan logs quiet.
    const message = error instanceof Error ? error.message : String(error);
    const isBenignMissing =
      message.includes("Manifest") ||
      message.includes("not found") ||
      message.includes("UnsupportedType") ||
      message.includes("no readable C2PA") ||
      message.includes("No claim") ||
      message.includes("JumbfNotFound");

    if (isBenignMissing) {
      mediaLogger.debug(
        { filePath, mime },
        "asset carries no readable C2PA data"
      );
    } else {
      mediaLogger.warn(
        { error: message, filePath, mime },
        "unexpected C2PA inspection failure"
      );
    }
    return xmpResult;
  }
  if (!reader) {
    return xmpResult;
  }

  const active = reader.getActive();
  if (!active) {
    return xmpResult;
  }

  const verdict = detectAiFromManifestStore(reader.json());
  verdict.evidence.push(...xmpVerdict.evidence);
  verdict.aiGenerated ||= xmpVerdict.aiGenerated;
  return {
    claimGenerator: active.claim_generator_info?.[0]?.name ?? null,
    signatureTrusted: false,
    sourceMediaId,
    verdict,
  };
}
