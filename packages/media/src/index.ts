// @asm/media: shared media pipeline contracts. Pure module - no runtime
// dependencies, safe for client bundles and workers alike.

export {
  MEDIA_ENCODER_VERSION,
  MEDIA_PIPELINE_VERSION,
  MEDIA_JOB_NAMES,
} from "./types";
export type {
  AudioStreamMetadata,
  AudioTechMetadata,
  DerivativeKind,
  DetectedContent,
  DerivativeRecordInput,
  ImageTechMetadata,
  MediaAnalyzeJobData,
  MediaCleanupJobData,
  MediaDeleteCascadeJobData,
  MediaProcessJobData,
  MediaScanJobData,
  MediaStatus,
  MediaType,
  MediaVisibility,
  PipelineFailure,
  RejectionReason,
  SafetyVerdict,
  VideoStreamMetadata,
  VideoTechMetadata,
} from "./types";
export { isAudioTechMetadata, isVideoTechMetadata } from "./types";

export {
  DEFAULT_LIMITS,
  MAX_POST_ATTACHMENTS,
  maxBytesForType,
  resolveMediaLimits,
} from "./limits";
export type { MediaLimits } from "./limits";

export {
  DERIVED_PREFIX,
  derivativeKey,
  derivativeName,
  hlsBaseFromMasterKey,
  isSafeHlsFilename,
  MEDIA_PREFIX,
  publishedKey,
  QUARANTINE_PREFIX,
  quarantineKey,
  sanitizeExtension,
} from "./keys";

export {
  allowedTransitions,
  assertTransition,
  canTransition,
  CLAIMABLE_STATUSES,
  InvalidTransitionError,
  isTerminalStatus,
} from "./state-machine";

export { detectContent, verifyDeclaredMatchesContent } from "./magic";
export type { ContentDetection } from "./magic";

export { readJpegExifOrientation, stripImageMetadata } from "./strip-metadata";
export type { StripOutcome } from "./strip-metadata";

export {
  AUDIO_FPRINT_LENGTH,
  AUDIO_FPRINT_MATCH_DISTANCE,
  hammingDistanceHex,
  isLikelyDuplicateAudioHash,
  isLikelyDuplicateHash,
  PHASH_MATCH_DISTANCE,
} from "./perceptual-hash";

export {
  KNOWN_AI_GENERATORS,
  PLATFORM_PROVENANCE_LABEL,
  SYNTHETIC_DIGITAL_SOURCE_TYPES,
  detectAiFromManifestStore,
  isStampableForC2Pa,
} from "./provenance";
export type {
  AiEvidence,
  AiProvenanceVerdict,
  MediaAiProvenance,
  PlatformProvenance,
} from "./provenance";

export {
  buildWatermarkPattern,
  buildWatermarkPayload,
  crc16Ccitt,
  hashUserId,
} from "./watermark";
export type { WatermarkPayload } from "./types";

export {
  AUDIO_AAC_KBPS,
  AUDIO_OPUS_KBPS,
  AUDIO_TARGET_LUFS,
  avContainerExtension,
  classifyImage,
  isAvMetadataStripContainer,
  needsFaststart,
  planImageDerivatives,
  planVideoOutputs,
  WAVEFORM_PEAK_POINTS,
} from "./format-policy";
export type {
  ImageClass,
  ImageFormat,
  ImagePlanInput,
  PlannedImageDerivative,
  VideoLadderRung,
  VideoPlan,
} from "./format-policy";
