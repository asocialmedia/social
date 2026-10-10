#!/usr/bin/env bun
// Creates this test corpus in one transaction without modifying existing users.
// Usage: bun --env-file=apps/web/.env.development scripts/seed-den-ui-test.ts --apply
// Without --apply the script prints its plan and checks for account collisions.

import {
  hashPasswordWithScrypt,
  verifyPasswordWithScrypt,
} from "@asm/auth/core";
import {
  closePrisma,
  fromPrismaDateTime,
  generateDenShortCode,
  generateInviteCode,
  listDenMembershipEvents,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  encryptMessage,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  KDF_ITERATIONS,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  unwrapRootKey,
  wrapRootKeyForMembers,
} from "../apps/web/src/lib/messages/crypto";
import {
  readerMessageWindows,
  readerWindowsContain,
} from "../apps/web/src/lib/messages/reader-window";
import {
  buildDenUiTestMessages,
  DEN_UI_TEST_ID,
  DEN_UI_TEST_MEMBERS,
  DEN_UI_TEST_PASSWORD,
} from "./den-ui-test-workload";

const DEN_NAME = "Test Den · 55 Members";
const OWNER = DEN_UI_TEST_MEMBERS[0];
if (!OWNER) {
  throw new Error("Test owner missing");
}
const owner = OWNER;

async function verify() {
  const members = await prisma.orm.public.MessageConversationMembers.select(
    "userId",
    "role",
    "createdAt",
    "leftAt"
  )
    .where({ conversationId: DEN_UI_TEST_ID })
    .all();
  const messages = await prisma.orm.public.Messages.where({
    conversationId: DEN_UI_TEST_ID,
  })
    .orderBy((row) => row.createdAt.asc())
    .all();
  const identities = await prisma.orm.public.MessageIdentities.where((row) =>
    row.userId.in(DEN_UI_TEST_MEMBERS.map((member) => member.id))
  ).all();
  const wraps = await prisma.orm.public.MessageConversationKeys.where({
    conversationId: DEN_UI_TEST_ID,
  }).all();
  const accounts = await prisma.orm.public.Accounts.where((row) =>
    row.userId.in(DEN_UI_TEST_MEMBERS.map((member) => member.id))
  ).all();
  if (
    members.length !== 55 ||
    messages.length !== 1000 ||
    identities.length !== 55 ||
    wraps.length !== 55 ||
    accounts.length !== 55 ||
    !members.some(
      (member) => member.userId === owner.id && member.role === "OWNER"
    )
  ) {
    throw new Error(
      "Test corpus counts or ownership do not match the requested fixture"
    );
  }
  let root: Uint8Array | undefined;
  for (const identity of identities) {
    if (!identity.masterKeyHash) {
      throw new Error("Stored recovery seed missing");
    }
    // oxlint-disable-next-line no-await-in-loop -- verify each stored identity independently with bounded crypto memory
    const master = await deriveMasterKey(
      identity.masterKeyHash,
      Buffer.from(identity.salt, "base64"),
      identity.kdfIterations
    );
    const [iv, ciphertext] = identity.encryptedPrivateKey.split(".");
    if (!iv || !ciphertext) {
      throw new Error("Stored private key unreadable");
    }
    // oxlint-disable-next-line no-await-in-loop -- recovery is a sequential chain for this identity
    const privateKey = await importPrivateKeyJwk(
      JSON.parse(await decryptWithMasterKey(master, { ciphertext, iv }))
    );
    const wrap = wraps.find((row) => row.ownerUserId === identity.userId);
    if (!wrap?.wrapperPublicKey) {
      throw new Error("Root wrap missing");
    }
    // oxlint-disable-next-line no-await-in-loop -- recovery must use this member's stored wrap
    const memberRoot = await unwrapRootKey(
      privateKey,
      await importPublicKeyJwk(publicKeyBase64ToJwk(wrap.wrapperPublicKey)),
      DEN_UI_TEST_ID,
      { ciphertext: wrap.encryptedKey, iv: wrap.iv }
    );
    if (
      root &&
      Buffer.compare(Buffer.from(root), Buffer.from(memberRoot)) !== 0
    ) {
      throw new Error("Members recovered different roots");
    }
    root = memberRoot;
    const account = accounts.find(
      (row) => row.userId === identity.userId && row.providerId === "credential"
    );
    // oxlint-disable-next-line no-await-in-loop -- check every stored credential without queuing 55 scrypt allocations
    if (
      !account?.password ||
      !(await verifyPasswordWithScrypt(DEN_UI_TEST_PASSWORD, account.password))
    ) {
      throw new Error("Test password verification failed");
    }
  }
  if (!root) {
    throw new Error("No recovered root");
  }
  const events = await listDenMembershipEvents(DEN_UI_TEST_ID, null);
  const messageDates = messages.map((message) =>
    fromPrismaDateTime(message.createdAt)
  );
  for (const member of members) {
    const windows = readerMessageWindows({
      conversationType: "DEN",
      events,
      membership: {
        createdAt: fromPrismaDateTime(member.createdAt),
        leftAt: member.leftAt ? fromPrismaDateTime(member.leftAt) : null,
      },
      userId: member.userId,
    });
    if (messageDates.some((date) => !readerWindowsContain(windows, date))) {
      throw new Error(
        `Test history is outside ${member.userId}'s membership window`
      );
    }
  }
  const payloads = await Promise.all(
    messages.map((message) =>
      decryptMessage(root, message.senderId, DEN_UI_TEST_ID, message)
    )
  );
  const imageMessages = payloads.filter(
    (payload) => payload.type === "media"
  ).length;
  const linkMessages = payloads.filter(
    (payload) => payload.type === "text" && payload.content.startsWith("Link ")
  ).length;
  if (imageMessages !== 100 || linkMessages !== 200) {
    throw new Error("Media/link counts did not verify");
  }
  console.log(
    JSON.stringify(
      {
        den: DEN_NAME,
        denId: DEN_UI_TEST_ID,
        members: members.length,
        messages: messages.length,
        imageMessages,
        linkMessages,
        recoveredIdentities: identities.length,
        owner: {
          username: owner.username,
          email: owner.email,
          password: DEN_UI_TEST_PASSWORD,
        },
        path: `/messages?c=${DEN_UI_TEST_ID}`,
      },
      null,
      2
    )
  );
}

async function main() {
  const existing = await prisma.orm.public.MessageConversations.select("id")
    .where({ id: DEN_UI_TEST_ID })
    .first();
  if (existing) {
    await verify();
    return;
  }
  const collisions = await prisma.orm.public.Users.select("username")
    .where((row) =>
      row.username.in(DEN_UI_TEST_MEMBERS.map((member) => member.username))
    )
    .all();
  if (collisions.length > 0) {
    throw new Error(
      "Test usernames already exist; refusing to change existing accounts"
    );
  }
  if (!process.argv.includes("--apply")) {
    console.log(
      "Plan: 55 new accounts, Test@1234 for all, one den, 1000 encrypted messages (700 text, 200 links, 100 images). Pass --apply to write."
    );
    return;
  }
  console.log(
    "Preparing credentials and recoverable identities for 55 test members…"
  );
  const prepared = await Promise.all(
    DEN_UI_TEST_MEMBERS.map(async (member) => {
      const pair = await generateIdentityKeyPair();
      const masterKeyHash = await hashAccountSecret(generateAccountSecret());
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const master = await deriveMasterKey(masterKeyHash, salt, KDF_ITERATIONS);
      const backup = await encryptWithMasterKey(
        master,
        JSON.stringify(await exportPrivateKeyJwk(pair.privateKey))
      );
      const publicKey = publicKeyJwkToBase64(
        await exportPublicKeyJwk(pair.publicKey)
      );
      return {
        member,
        password: await hashPasswordWithScrypt(DEN_UI_TEST_PASSWORD),
        privateKey: pair.privateKey,
        identity: {
          encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
          kdfIterations: KDF_ITERATIONS,
          masterKeyHash,
          publicKey,
          salt: Buffer.from(salt).toString("base64"),
          userId: member.id,
        },
      };
    })
  );
  const ownerKeys = prepared.find((entry) => entry.member.id === owner.id);
  if (!ownerKeys) {
    throw new Error("Owner keys missing");
  }
  const root = generateRootKey();
  const fanout = await wrapRootKeyForMembers(
    ownerKeys.privateKey,
    prepared.map((entry) => ({
      publicKeyBase64: entry.identity.publicKey,
      userId: entry.member.id,
    })),
    DEN_UI_TEST_ID,
    root
  );
  if (fanout.skipped.length > 0) {
    throw new Error("Test key wrapping skipped a member");
  }
  const counters = new Map<string, number>();
  const transcript = buildDenUiTestMessages();
  const timestamp = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Membership and key epochs precede history, matching the routes' read windows.
  const createdAt = toPrismaDateTime(new Date(timestamp - 60_000));
  const rows = await Promise.all(
    transcript.map(async (message, index) => {
      const ratchetIndex = counters.get(message.senderId) ?? 0;
      counters.set(message.senderId, ratchetIndex + 1);
      return {
        ...(await encryptMessage(
          root,
          message.senderId,
          ratchetIndex,
          DEN_UI_TEST_ID,
          message.payload
        )),
        conversationId: DEN_UI_TEST_ID,
        senderId: message.senderId,
        createdAt: toPrismaDateTime(
          new Date(timestamp + index * 10 * 60 * 1000)
        ),
      };
    })
  );
  const inviteCode = generateInviteCode();
  const inviteShortCode = generateDenShortCode();
  const retired = await prisma.orm.public.MessageConversationInviteCodes.select(
    "code"
  )
    .where((row) => row.code.in([inviteCode, inviteShortCode]))
    .all();
  if (retired.length > 0) {
    throw new Error(
      "Generated code collided with retired code; rerun before any writes"
    );
  }
  console.log("Writing the complete corpus in one transaction…");
  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      DEN_UI_TEST_MEMBERS.map((member) => ({ ...member, emailVerified: true }))
    );
    await tx.orm.public.Accounts.createAll(
      prepared.map((entry) => ({
        accountId: entry.member.id,
        password: entry.password,
        providerId: "credential",
        userId: entry.member.id,
      }))
    );
    await tx.orm.public.MessageIdentities.createAll(
      prepared.map((entry) => entry.identity)
    );
    await tx.orm.public.Follows.createAll(
      DEN_UI_TEST_MEMBERS.slice(1).map((member) => ({
        followerId: owner.id,
        followingId: member.id,
      }))
    );
    await tx.orm.public.MessageConversations.create({
      _type: "DEN",
      createdAt,
      createdById: owner.id,
      description:
        "UI test den with 55 members, 1,000 messages, links, and images.",
      id: DEN_UI_TEST_ID,
      inviteCode,
      inviteShortCode,
      name: DEN_NAME,
      ownerId: owner.id,
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      DEN_UI_TEST_MEMBERS.map((member, index) => ({
        conversationId: DEN_UI_TEST_ID,
        createdAt,
        invitedById: index === 0 ? null : owner.id,
        role: index === 0 ? "OWNER" : "MEMBER",
        userId: member.id,
      }))
    );
    await tx.orm.public.MessageConversationKeys.createAll(
      fanout.wrapped.map((wrap) => ({
        conversationId: DEN_UI_TEST_ID,
        createdAt,
        encryptedKey: wrap.encryptedKey.ciphertext,
        iv: wrap.encryptedKey.iv,
        ownerUserId: wrap.userId,
        ratchetCounter: counters.get(wrap.userId) ?? 0,
        version: 1,
        wrapperPublicKey: ownerKeys.identity.publicKey,
        wrapperUserId: owner.id,
      }))
    );
    await tx.orm.public.Messages.createAll(rows);
    await tx.orm.public.MessageConversationMembershipEvents.create({
      action: "CREATED",
      actorId: owner.id,
      actorName: owner.displayName,
      conversationId: DEN_UI_TEST_ID,
      createdAt,
    });
  });
  await verify();
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
await closePrisma();
process.exit(process.exitCode ?? 0);
