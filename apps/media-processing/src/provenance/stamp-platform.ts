// Platform provenance stamp for *all* stampable assets (not just AI).
// Mirrors stampAiGenerated's Builder/Reader pattern, but carries
// cc.asocialmedia.provenance with hashed uploader identity and no
// "AI Generated" assertion — the DB remains authoritative for that flag.

import { MEDIA_ENCODER_VERSION, MEDIA_PIPELINE_VERSION } from "@asm/media";
import { Builder, Reader } from "@contentauth/c2pa-node";

import { workerEnv } from "../env";
import { mediaLogger } from "../log";
import { loadProvenanceSigner } from "./signer";

export interface PlatformStampContext {
  mediaId: string;
  mime: string;
  hashedUploaderId: string | null;
  uploaderDisplayName: string | null;
  uploaderUsername: string | null;
}

export async function stampPlatformProvenance(
  inputPath: string,
  outputPath: string,
  context: PlatformStampContext
): Promise<boolean> {
  const signer = await loadProvenanceSigner();
  if (!signer) {
    return false;
  }

  const builder = Builder.new({
    verify: {
      verify_after_reading: false,
      verify_after_sign: false,
      verify_trust: false,
    },
  });

  try {
    const source = await Reader.fromAsset(
      { mimeType: context.mime, path: inputPath },
      { verify: { verify_after_reading: false, verify_trust: false } }
    );
    if (source?.getActive()) {
      builder.addIngredientFromReader(source);
    }
  } catch {
    mediaLogger.debug(
      { mediaId: context.mediaId },
      "no source C2PA chain to preserve while platform-stamping"
    );
  }

  builder.setIntent("edit");

  const stampedAt = new Date().toISOString();
  const baseUrl = workerEnv.PUBLIC_BASE_URL;
  const siteHost = new URL(baseUrl).hostname.replace(/^www\./u, "");

  builder.addAssertion("cc.asocialmedia.provenance", {
    encoderVersion: MEDIA_ENCODER_VERSION,
    hashedUploaderId: context.hashedUploaderId,
    mediaId: context.mediaId,
    pipelineVersion: MEDIA_PIPELINE_VERSION,
    platform: "asocialmedia.cc",
    stampedAt,
    uploaderDisplayName: context.uploaderDisplayName,
    uploaderUsername: context.uploaderUsername,
  });

  builder.addAssertion("stds.schema-org.CustomMetadata", {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    dateModified: stampedAt,
    identifier: `${baseUrl}/media/${context.mediaId}`,
    name: "Published on asocialmedia.cc",
    publisher: siteHost,
  });

  await builder.sign(
    signer,
    { mimeType: context.mime, path: inputPath },
    { mimeType: context.mime, path: outputPath }
  );
  return true;
}
