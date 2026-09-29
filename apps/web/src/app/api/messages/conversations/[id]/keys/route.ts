import { prisma, publishMessageKeysRotated } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  getConversationForUser,
  isUniqueConstraintViolation,
  parseJsonBody,
} from "@/lib/messages/server";

export interface WrappedKeyPayload {
  encryptedKey: {
    ciphertext: string;
    iv: string;
  };
  ownerUserId: string;
  // Root-key epoch. Omitted by legacy clients, which means epoch 1.
  version?: number;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const conversation = await getConversationForUser(id, user.id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as { keys?: WrappedKeyPayload[] } | null;
  const { keys } = body ?? {};
  if (!Array.isArray(keys) || keys.length === 0) {
    return Response.json({ error: "keys are required" }, { status: 400 });
  }

  // The caller (the conversation creator) must wrap the root key for every
  // member. Validate each owner is a member and every payload is well-formed
  // and non-empty (an empty ciphertext/iv would corrupt the peer's unwrap).
  const memberIds = new Set(
    conversation.members.map((member) => member.userId)
  );
  for (const key of keys) {
    if (
      typeof key.ownerUserId !== "string" ||
      !memberIds.has(key.ownerUserId) ||
      typeof key.encryptedKey?.ciphertext !== "string" ||
      key.encryptedKey.ciphertext.length === 0 ||
      typeof key.encryptedKey?.iv !== "string" ||
      key.encryptedKey.iv.length === 0
    ) {
      return Response.json({ error: "Invalid key payload" }, { status: 400 });
    }
  }

  // Epochs are conversation-wide: both members' wraps for a version denote the
  // same root, so the ceiling is the conversation's highest version, not a
  // per-owner one. Accept the next epoch (current max + 1) or any already-seen
  // version (a no-op idempotent heal); reject a backwards or absurdly jumped
  // version. Appends cannot clobber an existing wrap thanks to the
  // (conversationId, ownerUserId, version) unique index.
  const highest = await prisma.orm.public.MessageConversationKeys.select(
    "version"
  )
    .where({ conversationId: id })
    .orderBy((key) => key.version.desc())
    .first();
  const maxVersion = highest?.version ?? 0;

  const rows = keys.map((key) => {
    const version = key.version ?? 1;
    if (!Number.isInteger(version) || version < 1 || version > maxVersion + 1) {
      return null;
    }
    return {
      conversationId: id,
      encryptedKey: key.encryptedKey.ciphertext,
      iv: key.encryptedKey.iv,
      ownerUserId: key.ownerUserId,
      version,
    };
  });
  if (rows.some((row) => row === null)) {
    return Response.json({ error: "Invalid key version" }, { status: 409 });
  }

  // Create-only: a wrapped key may never be overwritten. Once a key exists for
  // an (owner, version) it is immutable, so a re-run (heal path, concurrent
  // retry) is a no-op instead of replacing the ciphertext the peer relies on.
  // Prisma 8 has no createMany/skipDuplicates, so each row is written on its own
  // and a unique-index collision is treated as "already present" rather than a
  // failure - that also makes a concurrent retry safe.
  const existing = await prisma.orm.public.MessageConversationKeys.select(
    "ownerUserId",
    "version"
  )
    .where({ conversationId: id })
    .all();
  const existingPairs = new Set(
    existing.map((key) => `${key.ownerUserId}:${key.version}`)
  );

  const pending = rows.filter(
    (row): row is NonNullable<typeof row> =>
      row !== null && !existingPairs.has(`${row.ownerUserId}:${row.version}`)
  );
  const results = await Promise.all(
    pending.map(async (row) => {
      try {
        await prisma.orm.public.MessageConversationKeys.create(row);
        return true;
      } catch (error) {
        // A concurrent retry inserting the same (owner, version) pair loses the
        // unique index; that is the same no-op, not a failure.
        if (isUniqueConstraintViolation(error)) {
          return false;
        }
        throw error;
      }
    })
  );
  const written = results.filter(Boolean).length;

  // Tell the peer's open threads to refetch the conversation detail. A new
  // epoch means their cached wraps are stale and every new message would fail
  // to decrypt until a reload. Only announce when rows were actually written:
  // an idempotent re-run has nothing new for the peer to pick up. Publishing is
  // best-effort (the peer's retry-on-error path still heals without it), so a
  // pub/sub failure must not fail the key write.
  if (written > 0) {
    await publishMessageKeysRotated(id, user.id);
  }

  return Response.json({ ok: true });
}
