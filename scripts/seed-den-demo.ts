#!/usr/bin/env bun

// Seeds a demo den with five members and real, decryptable chat history so the
// whole feature can be verified by hand in the browser.
//
// Why this cannot just insert rows: browsers encrypt with keys the server never
// holds in usable form. But current identity rows derive the backup key from
// the stored hash alone (see unlockIdentity in message-identity-provider), so a
// seeder that provisions identities exactly like enableIdentity does can walk
// the same chain the client walks: provision -> wrap a root key per member ->
// encrypt per the ratchet scheme. Every step below imports the app's own
// crypto.ts rather than reimplementing it.
//
// Usage:
//   DATABASE_URL=... bun scripts/seed-den-demo.ts [--fresh]
//
// Without --fresh, an existing "Demo Den" owned by alice_demo is reused and
// nothing is written. With --fresh, that den is dissolved first and rebuilt.

import { closePrisma, createDen, prisma, toPrismaDateTime } from "@asm/db";

import {
  decryptMessage,
  deriveMasterKey,
  deriveMessageKeyFromBase,
  decryptWithMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  importRatchetBaseKey,
  KDF_ITERATIONS,
  publicKeyBase64ToJwk,
  publicKeyJwkToBase64,
  unwrapRootKey,
  wrapRootKeyForMembers,
} from "../apps/web/src/lib/messages/crypto";
import type { MessagePayload } from "../apps/web/src/lib/messages/crypto";
import { hashPasswordWithScrypt } from "../packages/auth/src/core/password";

const DEMO_PASSWORD = "demo-den-1234";
const DEN_NAME = "Demo Den";

const MEMBERS = [
  { displayName: "Alice", username: "alice_demo" },
  { displayName: "Bob", username: "bob_demo" },
  { displayName: "Cara", username: "cara_demo" },
  { displayName: "Dan", username: "dan_demo" },
  { displayName: "Erin", username: "erin_demo" },
] as const;

const OWNER = "alice_demo";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function ensureUser(
  username: string,
  displayName: string
): Promise<string> {
  const existing = await prisma.orm.public.Users.select("id")
    .where({ username })
    .first();
  if (existing) {
    return existing.id;
  }
  const id = username;
  await prisma.orm.public.Users.create({
    displayName,
    email: `${username}@demo.local`,
    emailVerified: true,
    id,
    username,
  });
  await prisma.orm.public.Accounts.create({
    accountId: id,
    password: await hashPasswordWithScrypt(DEMO_PASSWORD),
    providerId: "credential",
    userId: id,
  });
  console.log(`  user      ${username} created (password: ${DEMO_PASSWORD})`);
  return id;
}

// Provisions exactly what enableIdentity provisions: a P-256 keypair, a random
// 16-byte salt, a random account secret whose SHA-256 hash is stored, and the
// private key encrypted under a PBKDF2 key derived from that stored hash. Any
// browser opening the app as this user unlocks with no input.
async function ensureIdentity(
  userId: string
): Promise<{ privateKey: CryptoKey; publicKeyBase64: string }> {
  const existing = await prisma.orm.public.MessageIdentities.where({
    userId,
  }).first();
  if (existing) {
    if (!existing.masterKeyHash) {
      throw new Error(`${userId} has no masterKeyHash to recover from`);
    }
    const masterKey = await deriveMasterKey(
      existing.masterKeyHash,
      Uint8Array.from(atob(existing.salt), (c) => c.codePointAt(0) ?? 0),
      existing.kdfIterations
    );
    const [iv, ciphertext] = existing.encryptedPrivateKey.split(".");
    if (!iv || !ciphertext) {
      throw new Error(`${userId} has an unreadable encryptedPrivateKey`);
    }
    const privateKey = await importPrivateKeyJwk(
      JSON.parse(await decryptWithMasterKey(masterKey, { ciphertext, iv }))
    );
    return { privateKey, publicKeyBase64: existing.publicKey };
  }
  const pair = await generateIdentityKeyPair();
  const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const secret = generateAccountSecret();
  const masterKeyHash = await hashAccountSecret(secret);
  const masterKey = await deriveMasterKey(masterKeyHash, salt, KDF_ITERATIONS);
  const backup = await encryptWithMasterKey(
    masterKey,
    JSON.stringify(privateKeyJwk)
  );
  const publicKeyBase64 = publicKeyJwkToBase64(
    await exportPublicKeyJwk(pair.publicKey)
  );
  await prisma.orm.public.MessageIdentities.create({
    encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    kdfIterations: KDF_ITERATIONS,
    masterKeyHash,
    publicKey: publicKeyBase64,
    salt: Buffer.from(salt).toString("base64"),
    userId,
  });
  console.log(`  identity  ${userId} provisioned`);
  return { privateKey: pair.privateKey, publicKeyBase64 };
}

// Den chatter that exercises the surfaces worth verifying: several senders,
// an edited message, a rare word for search, and an invite-code mention.
function buildTranscript(): {
  edited?: boolean;
  sender: string;
  text: string;
}[] {
  return [
    {
      sender: "alice_demo",
      text: "Welcome to the Demo Den! This is our shared space.",
    },
    {
      sender: "bob_demo",
      text: "Finally, a group chat that isn't a DM thread of chaos",
    },
    {
      sender: "cara_demo",
      text: "Can confirm, my DMs were 90% unread before this",
    },
    {
      sender: "dan_demo",
      text: "So how do the elder powers work here? Asking for a friend",
    },
    {
      sender: "alice_demo",
      text: "I'm owner, which mostly means I get to rename us when I feel like it",
    },
    {
      sender: "erin_demo",
      text: "Please don't rename us to something with emojis",
    },
    { sender: "bob_demo", text: "Seconded. No emojis in the den name" },
    {
      sender: "cara_demo",
      text: "What happens if someone leaves? Does the den survive?",
    },
    {
      sender: "alice_demo",
      text: "It does - ownership passes to whoever has been here longest",
    },
    {
      sender: "dan_demo",
      text: "Good to know the zarquon protocol covers succession planning",
    },
    { sender: "bob_demo", text: "The what now" },
    {
      sender: "dan_demo",
      text: "You know. The zarquon protocol. Everybody knows it",
    },
    {
      sender: "erin_demo",
      text: "I understood maybe three words of that exchange",
    },
    {
      sender: "cara_demo",
      text: "Anyway - mute works per person here, right? I muted my fantasy league den last week",
    },
    {
      sender: "alice_demo",
      text: "Yep, mute is yours alone. Nobody else sees it",
    },
    {
      sender: "bob_demo",
      text: "Typing indicators in a group of five is going to be chaos and I love it",
    },
    { sender: "erin_demo", text: "Three dots times five people. Beautiful" },
    {
      sender: "dan_demo",
      text: "Has anyone tried the invite link yet? I want to see the join screen",
    },
    {
      sender: "alice_demo",
      text: "It's in the den panel - copy it, rotate it when it leaks",
    },
    {
      sender: "cara_demo",
      text: "Rotating kills the old link instantly? That's the dream for stopping link sprawl",
    },
    {
      sender: "bob_demo",
      text: "Okay but real question: who reads the notifications when all five of us reply at once",
    },
    {
      sender: "erin_demo",
      text: "They fold into one row, apparently. One row to dismiss them all",
    },
    {
      sender: "dan_demo",
      text: "Fancy. My old group chat gave me forty separate buzzes for one argument",
    },
    {
      sender: "alice_demo",
      text: "Alright, quick check - everyone can see the roster with roles?",
    },
    { sender: "cara_demo", text: "Owner crown and everything. Very regal" },
    {
      sender: "bob_demo",
      text: "Can someone verify search finds zarquon later? For science",
    },
    { sender: "erin_demo", text: "For science", edited: true },
    {
      sender: "dan_demo",
      text: "This den is officially my favorite shared space on the internet",
    },
    {
      sender: "alice_demo",
      text: "Mine too. Now somebody say something worth editing",
    },
    {
      sender: "bob_demo",
      text: "I never make typos and this message proves it",
    },
  ];
}

async function main(): Promise<void> {
  const fresh = process.argv.includes("--fresh");

  const ids: Record<string, string> = {};
  for (const member of MEMBERS) {
    ids[member.username] = await ensureUser(
      member.username,
      member.displayName
    );
  }
  const keys: Record<
    string,
    { privateKey: CryptoKey; publicKeyBase64: string }
  > = {};
  for (const member of MEMBERS) {
    keys[member.username] = await ensureIdentity(ids[member.username] ?? "");
  }

  const ownerId = ids[OWNER] ?? "";
  const memberIds = MEMBERS.map((m) => ids[m.username] ?? "").filter(
    (id) => id !== ownerId
  );

  let den = await prisma.orm.public.MessageConversations.select(
    "id",
    "inviteCode"
  )
    .where((c) => c.name.eq(DEN_NAME))
    .first();
  if (den && fresh) {
    await prisma.orm.public.MessageConversations.where((c) =>
      c.id.eq(den?.id ?? "")
    ).deleteAndCount();
    console.log(`  den       removed existing "${DEN_NAME}" (--fresh)`);
    den = null;
  }
  let denId: string;
  let inviteCode: string;
  if (den) {
    denId = den.id;
    inviteCode = den.inviteCode ?? "";
    console.log(`  den       reusing "${DEN_NAME}" (${denId})`);
  } else {
    const created = await createDen({
      creatorId: ownerId,
      description: "A den for verifying everything",
      memberIds,
      name: DEN_NAME,
    });
    denId = created.id;
    inviteCode = created.inviteCode;
    console.log(`  den       created "${DEN_NAME}" (${denId})`);
  }

  // Epoch 1: one root, wrapped per member, with the owner as the wrapper. This
  // is exactly what ensureConversationKeys would mint on first send.
  const existingWraps = await prisma.orm.public.MessageConversationKeys.where({
    conversationId: denId,
  }).aggregate((a) => ({ count: a.count() }));
  let rootKey: Uint8Array;
  if (existingWraps.count === 0) {
    rootKey = generateRootKey();
    const ownerKeys = keys[OWNER];
    if (!ownerKeys) {
      throw new Error("owner keys missing");
    }
    const fanout = await wrapRootKeyForMembers(
      ownerKeys.privateKey,
      MEMBERS.map((m) => ({
        publicKeyBase64: keys[m.username]?.publicKeyBase64 ?? "",
        userId: ids[m.username] ?? "",
      })),
      denId,
      rootKey
    );
    if (fanout.skipped.length > 0) {
      throw new Error(`fan-out skipped: ${fanout.skipped.join(", ")}`);
    }
    for (const wrap of fanout.wrapped) {
      await prisma.orm.public.MessageConversationKeys.create({
        conversationId: denId,
        encryptedKey: wrap.encryptedKey.ciphertext,
        iv: wrap.encryptedKey.iv,
        ownerUserId: wrap.userId,
        version: 1,
        wrapperPublicKey: ownerKeys.publicKeyBase64,
        wrapperUserId: ownerId,
      });
    }
    console.log(`  epoch     v1 root wrapped for all 5 members`);
  } else {
    // Re-derive the root from the owner's own wrap so the transcript below
    // encrypts under the same epoch the clients will read.
    const ownerKeys = keys[OWNER];
    if (!ownerKeys) {
      throw new Error("owner keys missing");
    }
    const wrap = await prisma.orm.public.MessageConversationKeys.select(
      "encryptedKey",
      "iv"
    )
      .where({ conversationId: denId, ownerUserId: ownerId })
      .orderBy((w) => w.version.desc())
      .first();
    if (!wrap) {
      throw new Error("den has key rows but none for the owner");
    }
    rootKey = await unwrapRootKey(
      ownerKeys.privateKey,
      await importPublicKeyJwk(publicKeyBase64ToJwk(ownerKeys.publicKeyBase64)),
      denId,
      { ciphertext: wrap.encryptedKey, iv: wrap.iv }
    );
    console.log(`  epoch     reusing existing wraps`);
  }

  const existingMessages = await prisma.orm.public.Messages.where({
    conversationId: denId,
  }).aggregate((aggregate) => ({ count: aggregate.count() }));
  if (existingMessages.count === 0) {
    const transcript = buildTranscript();
    const counters: Record<string, number> = {};
    for (const m of MEMBERS) {
      const latest = await prisma.orm.public.Messages.select("ratchetIndex")
        .where({ conversationId: denId, senderId: ids[m.username] ?? "" })
        .orderBy((row) => row.ratchetIndex.desc())
        .first();
      counters[m.username] = (latest?.ratchetIndex ?? -1) + 1;
    }
    const baseKeyBySender = new Map<string, CryptoKey>();
    for (const m of MEMBERS) {
      baseKeyBySender.set(m.username, await importRatchetBaseKey(rootKey));
    }
    const encoder = new TextEncoder();
    const now = Date.now();
    const spanMs = 2 * 24 * 60 * 60 * 1000;
    const rows: {
      ciphertext: string;
      conversationId: string;
      createdAt: ReturnType<typeof toPrismaDateTime>;
      editedAt?: ReturnType<typeof toPrismaDateTime> | null;
      iv: string;
      ratchetIndex: number;
      senderId: string;
    }[] = [];
    let position = 0;
    for (const line of transcript) {
      const senderId = ids[line.sender] ?? "";
      const ratchetIndex = counters[line.sender] ?? 0;
      counters[line.sender] = ratchetIndex + 1;
      const payload: MessagePayload = { content: line.text, type: "text" };
      const baseKey = baseKeyBySender.get(line.sender);
      if (!baseKey) {
        throw new Error(`no base key for ${line.sender}`);
      }
      const messageKey = await deriveMessageKeyFromBase(
        baseKey,
        senderId,
        ratchetIndex
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = encoder.encode(`${denId}:${senderId}:${ratchetIndex}`);
      const ciphertext = await crypto.subtle.encrypt(
        { additionalData: aad, iv, name: "AES-GCM" },
        messageKey,
        encoder.encode(JSON.stringify(payload))
      );
      const createdAt = new Date(
        now - spanMs + Math.floor((spanMs * position) / transcript.length)
      );
      position += 1;
      rows.push({
        ciphertext: base64(new Uint8Array(ciphertext)),
        conversationId: denId,
        createdAt: toPrismaDateTime(createdAt),
        editedAt: line.edited
          ? toPrismaDateTime(new Date(createdAt.getTime() + 60_000))
          : null,
        iv: base64(iv),
        ratchetIndex,
        senderId,
      });
    }
    await prisma.orm.public.Messages.createAll(rows);
    for (const m of MEMBERS) {
      await prisma.orm.public.MessageConversationKeys.where({
        conversationId: denId,
        ownerUserId: ids[m.username] ?? "",
      }).updateAll({ ratchetCounter: counters[m.username] ?? 0 });
    }
    console.log(`  chat      ${rows.length} messages from all 5 members`);
  } else {
    console.log(`  chat      ${existingMessages.count} messages already here`);
  }

  // Membership log lines, so the transcript's activity feed has something real
  // to show. `createDen` already writes a CREATED line, so this tops up only what
  // is missing rather than guarding on an empty table: re-running must not
  // duplicate. The timestamps sit before the chat so the lines read at the top.
  const existingEvents =
    await prisma.orm.public.MessageConversationMembershipEvents.select(
      "action",
      "targetUserId"
    )
      .where({ conversationId: denId })
      .all();
  const seen = new Set(
    existingEvents.map((event) => `${event.action}:${event.targetUserId ?? ""}`)
  );
  const createdBase = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const owner = ids.alice_demo ?? "";
  const nameOf = (userId: string): string =>
    MEMBERS.find((m) => ids[m.username] === userId)?.username ?? "Someone";
  const invited = [
    ids.bob_demo,
    ids.cara_demo,
    ids.dan_demo,
    ids.erin_demo,
  ].filter((id): id is string => Boolean(id));
  const rows: {
    action: "CREATED" | "JOINED" | "PROMOTED";
    actorId: string;
    actorName: string;
    conversationId: string;
    createdAt: ReturnType<typeof toPrismaDateTime>;
    targetName: string | null;
    targetUserId: string | null;
  }[] = [];
  if (!seen.has("CREATED:")) {
    rows.push({
      action: "CREATED",
      actorId: owner,
      actorName: "alice_demo",
      conversationId: denId,
      createdAt: toPrismaDateTime(new Date(createdBase)),
      targetName: null,
      targetUserId: null,
    });
  }
  invited.forEach((userId, index) => {
    if (seen.has(`JOINED:${userId}`)) {
      return;
    }
    rows.push({
      action: "JOINED",
      actorId: owner,
      actorName: "alice_demo",
      conversationId: denId,
      createdAt: toPrismaDateTime(new Date(createdBase + (index + 1) * 60_000)),
      targetName: nameOf(userId),
      targetUserId: userId,
    });
  });
  // A promotion too, and the role row is moved to match, so the log and the
  // roster agree. Bob is the Elder in this demo.
  if (ids.bob_demo && !seen.has(`PROMOTED:${ids.bob_demo}`)) {
    rows.push({
      action: "PROMOTED",
      actorId: owner,
      actorName: "alice_demo",
      conversationId: denId,
      createdAt: toPrismaDateTime(new Date(createdBase + 10 * 60_000)),
      targetName: "bob_demo",
      targetUserId: ids.bob_demo,
    });
  }
  if (rows.length > 0) {
    await prisma.orm.public.MessageConversationMembershipEvents.createAll(rows);
    console.log(`  log       added ${rows.length} membership events`);
  } else {
    console.log(`  log       membership events already complete`);
  }
  if (ids.bob_demo) {
    await prisma.orm.public.MessageConversationMembers.where({
      conversationId: denId,
      userId: ids.bob_demo,
    }).updateAll({ role: "ADMIN" });
  }

  // Prove the chain before reporting success: decrypt one message per sender.
  for (const m of MEMBERS) {
    const sample = await prisma.orm.public.Messages.select(
      "ciphertext",
      "iv",
      "ratchetIndex",
      "senderId"
    )
      .where({ conversationId: denId, senderId: ids[m.username] ?? "" })
      .orderBy((row) => row.ratchetIndex.desc())
      .first();
    if (!sample) {
      throw new Error(`no message from ${m.username} to verify`);
    }
    const payload = await decryptMessage(rootKey, sample.senderId, denId, {
      ciphertext: sample.ciphertext,
      iv: sample.iv,
      ratchetIndex: sample.ratchetIndex,
    });
    if (payload.type !== "text" || typeof payload.content !== "string") {
      throw new Error(`${m.username}'s message did not decrypt to text`);
    }
  }
  console.log(`  verify    one message per sender decrypts OK`);

  const members = await prisma.orm.public.MessageConversationMembers.select(
    "role",
    "userId"
  )
    .where((row) => row.conversationId.eq(denId))
    .all();
  console.log(`\nDen "${DEN_NAME}" (${denId})`);
  console.log(`Invite code: ${inviteCode}`);
  for (const row of members.toSorted((a, b) =>
    a.userId.localeCompare(b.userId)
  )) {
    console.log(`  ${row.userId} — ${row.role}`);
  }
  console.log(
    `\nLog in as username alice_demo (or bob_demo, cara_demo, dan_demo, erin_demo)`
  );
  console.log(`Password for all five: ${DEMO_PASSWORD}`);
  console.log(`Open /messages?c=${denId} (or pick "${DEN_NAME}" in the rail)`);
}

await main()
  .then(async () => {
    await closePrisma();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await closePrisma();
    process.exit(1);
  });
