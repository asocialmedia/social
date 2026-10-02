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
  // The member who performed this wrap, and the public key they used. A client
  // may only claim itself as the wrapper: the blob is an ECDH pairing with that
  // member's private key, so no other member can honestly be named.
  wrapperPublicKey?: string | null;
  wrapperUserId?: string | null;
}

// Normalizes an optional column: null for absent, and undefined for a value that is
// present but unusable, so a row is refused rather than stored as a half-truth.
function optionalNonEmptyString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

  // The caller must wrap the root key for every member. Validate each owner is a
  // member and every payload is well-formed and non-empty (an empty
  // ciphertext/iv would corrupt the peer's unwrap).
  //
  // A named wrapper must be the caller: only the holder of the private key a blob
  // was paired with can have produced it, so naming somebody else would be a lie
  // about which pairing a reader has to reconstruct. The snapshot key beside it is
  // public material, deliberately not checked against the identity row — it
  // exists precisely to outlive that row, and refusing the write in that case
  // would leave the caller unable to send at all.
  const memberIds = new Set(
    conversation.members.map((member) => member.userId)
  );
  for (const key of keys) {
    const wrapperUserId = optionalNonEmptyString(key.wrapperUserId);
    const wrapperPublicKey = optionalNonEmptyString(key.wrapperPublicKey);
    if (
      typeof key.ownerUserId !== "string" ||
      !memberIds.has(key.ownerUserId) ||
      typeof key.encryptedKey?.ciphertext !== "string" ||
      key.encryptedKey.ciphertext.length === 0 ||
      typeof key.encryptedKey?.iv !== "string" ||
      key.encryptedKey.iv.length === 0 ||
      wrapperPublicKey === undefined ||
      (wrapperUserId !== null && wrapperUserId !== user.id)
    ) {
      return Response.json({ error: "Invalid key payload" }, { status: 400 });
    }
  }

  // Epochs are conversation-wide: every member's wrap for a version denotes the
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
      wrapperPublicKey: optionalNonEmptyString(key.wrapperPublicKey) ?? null,
      wrapperUserId: optionalNonEmptyString(key.wrapperUserId) ?? null,
    };
  });
  if (rows.some((row) => row === null)) {
    return Response.json({ error: "Invalid key version" }, { status: 409 });
  }
  const inserts = rows.filter(
    (row): row is NonNullable<typeof row> => row !== null
  );
  // Whether this batch is minting a version rather than completing one. Measured
  // against the ceiling read above, so it states what this call was allowed to
  // create, not what it ended up writing.
  const newVersion = inserts.some((row) => row.version > maxVersion);

  // Create-only: a wrapped key may never be overwritten. Once a key exists for an
  // (owner, version) it is immutable, so a re-run (heal path, concurrent retry) is
  // a no-op instead of replacing the ciphertext a member relies on.
  const existing = await prisma.orm.public.MessageConversationKeys.select(
    "ownerUserId",
    "version"
  )
    .where({ conversationId: id })
    .all();
  const existingPairs = new Set(
    existing.map((key) => `${key.ownerUserId}:${key.version}`)
  );
  const pending = inserts.filter(
    (row) => !existingPairs.has(`${row.ownerUserId}:${row.version}`)
  );

  // A version above the ceiling is one this call is CREATING, not one it is
  // completing. Completing somebody else's version would put a second root key
  // under it: the members who already hold a wrap for that version unwrap one
  // root, the members this call wraps for unwrap the other, and the epoch can
  // never be repaired because the ceiling is max+1 and the version already
  // exists. It is reachable because the two reads above are not one snapshot — a
  // racing rotation can commit between the ceiling read and the pairs read, so the
  // pre-read sees its rows and quietly reduces this batch to the members it
  // missed.
  //
  // Refusing is the whole repair, and it has to happen before the write rather
  // than after: the rows this batch would add are the ones that make the version
  // disagree with itself. The caller re-reads, sees the winner's epoch complete,
  // and sends under it, which is the same recovery the unique violation below
  // already drives.
  if (newVersion && pending.length !== inserts.length) {
    return Response.json(
      { error: "Another rotation claimed this epoch" },
      { status: 409 }
    );
  }

  // How many rows this call actually stored. See the response below for why the
  // client reads it. This counts COMMITTED rows, so it starts at zero and only
  // moves once the transaction that wrote them is known to have committed.
  let inserted = 0;
  if (pending.length > 0) {
    // One transaction for the whole batch. A den epoch is one root key fanned out
    // to every member, so half of it is not a smaller win, it is an epoch some
    // members cannot read — and the next message sent under it would be
    // undecryptable for them. All-or-nothing also settles the concurrent-rotation
    // race: two members can pick the same next version, and whichever batch commits
    // first owns it. The loser's insert fails the unique index, its transaction
    // rolls back whole, and it lands on the winner's epoch instead of writing a
    // second root key under the same version.
    //
    // Prisma 8 has no createMany/skipDuplicates, so the rows are written one at a
    // time inside the transaction rather than in parallel: a transaction holds one
    // connection, and sequential writes under it buy determinism, not slowness.
    try {
      await prisma.transaction(async (tx) => {
        for (const row of pending) {
          // oxlint-disable-next-line no-await-in-loop -- sequential writes under one transaction connection, see above
          await tx.orm.public.MessageConversationKeys.create(row);
          inserted += 1;
        }
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      // The transaction rolled back whole, so nothing this call wrote is on file.
      // The counter has to go back to zero with it: a batch that unwound is not a
      // batch that stored anything, and reporting the rolled-back count would tell
      // a rotation it had won an epoch whose root key nobody — the sender
      // included — holds. Its next message would be encrypted under a key that
      // exists nowhere, which is the one failure this whole write path exists to
      // prevent.
      inserted = 0;
      // Another writer claimed one of these (owner, version) pairs first. If every
      // pair we asked for is now present, that writer covered this epoch and our
      // root key is simply redundant: accepting keeps a retry idempotent. If only
      // some are present, this would be a partially covered epoch, so the caller
      // is told to refetch and decide again rather than being handed a lie.
      const current = await prisma.orm.public.MessageConversationKeys.select(
        "ownerUserId",
        "version"
      )
        .where({ conversationId: id })
        .all();
      const currentPairs = new Set(
        current.map((key) => `${key.ownerUserId}:${key.version}`)
      );
      if (
        inserts.some(
          (row) => !currentPairs.has(`${row.ownerUserId}:${row.version}`)
        )
      ) {
        return Response.json(
          { error: "Another rotation claimed this epoch" },
          { status: 409 }
        );
      }
    }
  }

  // Tell the peer's open threads to refetch the conversation detail. A new
  // epoch means their cached wraps are stale and every new message fails to
  // decrypt until they reload.
  //
  // Announce on every accepted write, including one that inserted nothing.
  // Gating on `written > 0` looks like it drops no-op noise, but it loses a real
  // case: the wraps are stored, the publish fails, and the client retries. The
  // retry inserts nothing, so the gate suppresses the announcement the first
  // attempt already failed to deliver, and the peer is never told at all. The
  // peer's own fallback refetches on a decrypt failure, but only once per key
  // signature, so a failed refetch leaves an open thread unable to decrypt
  // until something else refreshes it. A duplicate announcement costs the peer
  // one refetch; a missed one costs them the conversation.
  //
  // Publishing stays best-effort, so a pub/sub failure must not fail the write.
  await publishMessageKeysRotated(id, user.id);

  // `applied` is how many of the requested rows this call actually stored, and it
  // is load-bearing rather than informational. Zero means every pair the caller
  // asked for was already on file: for a heal that is the idempotent retry, but for
  // a rotation it means another member minted that epoch first, so the root key
  // the caller is holding is not the den's root key. Reporting it lets that member
  // resolve the winning epoch and send under it, instead of encrypting a message
  // nobody — not even the sender — can read.
  return Response.json({ applied: inserted, ok: true });
}
