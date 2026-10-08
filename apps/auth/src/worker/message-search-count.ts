import {
  claimMessageSearchCountRequest,
  completeMessageSearchCountRequest,
  countMessageSearchCandidates,
  releaseMessageSearchCountRequest,
} from "@asm/db";

export async function processMessageSearchCount(
  requestId: string,
  logger: {
    error: (fields: Record<string, unknown>, message: string) => void;
  }
): Promise<void> {
  const request = await claimMessageSearchCountRequest(requestId);
  if (!request) {
    return;
  }
  try {
    const exactCount = await countMessageSearchCandidates({
      conversationId: request.conversationId,
      fragments: request.fragments,
      membershipWindows: request.membershipWindows,
      snapshotSequence: request.snapshotSequence,
      userId: request.userId,
    });
    await completeMessageSearchCountRequest(request.id, exactCount);
  } catch (error) {
    await releaseMessageSearchCountRequest(request.id).catch(() => null);
    logger.error({ requestId }, "DM search count processing failed");
    throw error;
  }
}
