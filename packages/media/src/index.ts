// @asm/media: shared media pipeline contracts. Pure module - no runtime
// dependencies, safe for client bundles and workers alike.

export {
  mediaIdentityXmp,
  readMediaIdentityXmp,
  mediaReshareLabel,
} from "./media-identity";

export {
  acceptsAvif,
  imageVariantForWidth,
  IMAGE_DELIVERY_WIDTHS,
  selectImageDerivative,
} from "./delivery";

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
  MAX_MESSAGE_ATTACHMENTS,
  MAX_POST_ATTACHMENTS,
  maxBytesForPurpose,
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
export {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  isMessageDocumentMime,
  maxMessageAttachmentBytes,
  messageAttachmentKind,
  messageAttachmentMediaType,
  messageAttachmentMimeType,
} from "./message-attachments";
export type {
  MessageAttachmentKind,
  MessageAttachmentMediaType,
} from "./message-attachments";
export type { ContentDetection } from "./magic";

export { readJpegExifOrientation, stripImageMetadata } from "./strip-metadata";
export type { StripOutcome } from "./strip-metadata";

export {
  isAnimatedStickerMimeType,
  isStickerSupportedMimeType,
  maxStickerInputBytes,
  maxStickerOutputBytes,
  STICKER_ANIMATED_MAX_INPUT_BYTES,
  STICKER_ANIMATED_MAX_OUTPUT_BYTES,
  STICKER_ANIMATED_MIME_TYPES,
  STICKER_CONVERSION_DAILY_LIMIT,
  STICKER_CONVERSION_PER_MINUTE_LIMIT,
  STICKER_LIBRARY_MAX_BYTES,
  STICKER_LIBRARY_MAX_ITEMS,
  STICKER_MAX_ANIMATION_DURATION_MS,
  STICKER_MAX_ANIMATION_FRAMES,
  STICKER_MAX_ANIMATED_FRAME_DIMENSION,
  STICKER_MAX_CANVAS_DIMENSION,
  STICKER_MAX_CONCURRENT_CONVERSIONS,
  STICKER_MAX_CUMULATIVE_FRAME_PIXELS,
  STICKER_MAX_DIMENSION,
  STICKER_MAX_PIXEL_COUNT,
  STICKER_STATIC_MAX_INPUT_BYTES,
  STICKER_STATIC_MAX_OUTPUT_BYTES,
  STICKER_STATIC_MIME_TYPES,
  STICKER_THUMBNAIL_DIMENSION,
  STICKER_THUMBNAIL_MAX_OUTPUT_BYTES,
  STICKER_SUPPORTED_MIME_TYPES,
} from "./sticker-policy";
export type { StickerSupportedMimeType } from "./sticker-policy";

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
  detectAiFromXmp,
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

export { EngagementSession } from "./engagement";
export type {
  EngagementEvent,
  EngagementEventType,
  EngagementSample,
} from "./engagement";
