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

export { DEFAULT_LIMITS, maxBytesForType, resolveMediaLimits } from "./limits";
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

export { stripImageMetadata } from "./strip-metadata";
export type { StripOutcome } from "./strip-metadata";

export {
  KNOWN_AI_GENERATORS,
  SYNTHETIC_DIGITAL_SOURCE_TYPES,
  detectAiFromManifestStore,
  isStampableForC2Pa,
} from "./provenance";
export type {
  AiEvidence,
  AiProvenanceVerdict,
  MediaAiProvenance,
} from "./provenance";

export {
  AUDIO_AAC_KBPS,
  AUDIO_OPUS_KBPS,
  AUDIO_TARGET_LUFS,
  classifyImage,
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
