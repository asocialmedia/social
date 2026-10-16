import { messageSearchEpochFingerprint, prisma } from "@asm/db";

// Concurrent scale fixtures seed the same shared owner identity at once, so
// the check-then-insert below can lose a race. A unique violation means a
// sibling fixture won with identical values and is safe to adopt.
function isIdentityRace(error: unknown): boolean {
  const details = error as { code?: unknown; sqlState?: unknown } | null;
  return (
    details?.code === "P2002" ||
    details?.code === "23505" ||
    details?.sqlState === "23505"
  );
}

// Query fixtures deliberately stub cryptographic verification; the worker integration suite uses real encrypted keys.
export async function seedVerifiedMessageEpochFixture(
  conversationId: string
): Promise<void> {
  const members = await prisma.orm.public.MessageConversationMembers.where({
    conversationId,
  }).all();
  for (const member of members) {
    // oxlint-disable-next-line no-await-in-loop -- Keep fixture identity creation deterministic.
    const identity = await prisma.orm.public.MessageIdentities.where({
      userId: member.userId,
    }).first();
    if (!identity) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- A fixture must exist before its proof can be constructed.
        await prisma.orm.public.MessageIdentities.create({
          encryptedPrivateKey: "fixture-iv.fixture-private",
          kdfIterations: 210_000,
          masterKeyHash: "a".repeat(64),
          publicKey: `fixture-public:${member.userId}`,
          salt: "fixture-salt",
          userId: member.userId,
        });
      } catch (error) {
        if (!isIdentityRace(error)) {
          throw error;
        }
      }
    }
  }
  const identities = await prisma.orm.public.MessageIdentities.where(
    (identity) => identity.userId.in(members.map((member) => member.userId))
  ).all();
  const identityByUserId = new Map(
    identities.map((identity) => [identity.userId, identity])
  );
  const wraps = await prisma.orm.public.MessageConversationKeys.where({
    conversationId,
  }).all();
  const conversation = await prisma.orm.public.MessageConversations.where({
    id: conversationId,
  }).first();
  for (const wrap of wraps) {
    const identity = identityByUserId.get(wrap.ownerUserId);
    if (!identity) {
      throw new Error("Fixture wrap has no identity");
    }
    const legacyPeerId =
      conversation?._type === "DM"
        ? members
            .map((member) => member.userId)
            .toSorted()
            .find((userId) => userId !== wrap.ownerUserId)
        : undefined;
    const resolvedWrapperPublicKey =
      wrap.wrapperPublicKey ??
      identityByUserId.get(wrap.wrapperUserId ?? legacyPeerId ?? "")
        ?.publicKey ??
      null;
    // oxlint-disable-next-line no-await-in-loop -- Fixture proofs use their current committed account generation.
    const account = await prisma.orm.public.MessageSearchAccountState.where({
      userId: wrap.ownerUserId,
    }).first();
    // oxlint-disable-next-line no-await-in-loop -- One proof belongs to one fixture wrap.
    await prisma.orm.public.MessageSearchEpochReadability.create({
      conversationId,
      keyEpoch: wrap.version,
      readable: true,
      recoveryGeneration: account?.recoveryGeneration ?? 0,
      sourceFingerprint: messageSearchEpochFingerprint({
        identity,
        resolvedWrapperPublicKey,
        wrap,
      }),
      userId: wrap.ownerUserId,
      wrapId: wrap.id,
    });
  }
}
