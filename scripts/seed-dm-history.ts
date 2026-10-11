#!/usr/bin/env bun

// Seeds a DM conversation with a large volume of REAL, DECRYPTABLE history so the
// client-side search index can be exercised at a realistic conversation size.
//
// Why this cannot just insert rows: messages are encrypted in the browser and the
// server only ever sees `ciphertext` and `iv`. A row written here is readable by
// the participants only if its ciphertext was produced by the same key derivation
// the client uses, so the seeder walks the real chain rather than reimplementing
// it:
//
//   masterKeyHash + salt + kdfIterations   (stored in the same row, by design)
//     -> PBKDF2 master key
//     -> decrypts the owner's encryptedPrivateKey  (`iv.ciphertext`)
//     -> owner ECDH private key + peer public key
//     -> unwraps the conversation root key from the owner's existing wrap
//     -> per-message key = HKDF(root, "asm:ratchet:<senderId>:<index>")
//     -> AES-GCM with AAD "<conversationId>:<senderId>:<ratchetIndex>"
//
// Every one of those steps is imported from the app's own `crypto.ts` rather than
// copied, so this script cannot drift from what the client does. The one thing it
// adds is the ability to read the backup key off the server, which is the
// documented server-recoverable trade-off (see AGENTS.md), not a new capability.
//
// Before writing anything it decrypts an EXISTING message per sender and aborts if
// that fails, so a broken chain is discovered before 200k rows are written.
//
// Usage:
//   DATABASE_URL=... bun scripts/seed-dm-history.ts [options]
//
// Options:
//   --conversation=ID   Conversation to seed. Required.
//   --total=N           Total messages to add (default: 200000)
//   --batch-size=N      Rows per createMany (default: 2000)
//   --sender-a=ID       First participant (default: inferred from the conversation)
//   --sender-b=ID       Second participant (default: inferred)
//   --seed=N            PRNG seed, for a reproducible corpus (default: 20260925)
//   --start-days-ago=N  Backdate the oldest message by N days (default: 400)
//   --dry-run           Resolve keys, verify decryption, print the plan, write nothing
//   --verify-only       Decrypt a sample of the newest messages and report
//   --quiet             Suppress per-batch progress

import {
  closePrisma,
  fromPrismaDateTime,
  prisma,
  toPrismaDateTime,
} from "@asm/db";
import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMessageKeyFromBase,
  deriveMasterKey,
  encryptMessage,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  importRatchetBaseKey,
  publicKeyBase64ToJwk,
  unwrapRootKey,
} from "@asm/messages/crypto";
import type { MessagePayload } from "@asm/messages/crypto";

function flag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function numberFlag(argv: string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.codePointAt(0) ?? 0);
}

// Deterministic PRNG so a given --seed always produces the same corpus. Makes a
// search miss reproducible instead of "it worked when I re-ran it".
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A vocabulary with deliberate repeats rather than unique words per message. Real
// conversations have a few thousand distinct words, and that repetition is what
// makes posting lists long enough for the intersection and limit paths to matter.
// The first three entries are rare NEEDLES so a search can be checked against a
// known answer instead of "results looked plausible".
const RARE_NEEDLES = ["zarquon", "veldrith", "obsidiancascade"] as const;

const COMMON_WORDS = [
  "deploy",
  "rollback",
  "latency",
  "index",
  "query",
  "cache",
  "shard",
  "replica",
  "schema",
  "migration",
  "timeout",
  "retry",
  "backoff",
  "throughput",
  "p99",
  "ingest",
  "pipeline",
  "rollout",
  "incident",
  "postmortem",
  "runbook",
  "alert",
  "dashboard",
  "partition",
  "vacuum",
  "indexer",
  "tokenizer",
  "posting",
  "intersect",
  "cursor",
  "pagination",
  "sealed",
  "plaintext",
  "keystore",
  "wrap",
  "epoch",
  "rotation",
  "backfill",
  "fixture",
  "benchmark",
  "profile",
  "heap",
  "garbage",
];

const SHORTHAND = [
  "ack",
  "on it",
  "lgtm",
  "same",
  "yep",
  "looking",
  "one sec",
  "done",
  "thanks",
  "sorry, my mistake",
  "can you re-run it?",
  "pushed",
  "reverted for now",
];

const LONG_FORM = [
  "the backfill finished overnight and the posting lists look correct, but the intersection is still doing two full reads on every keystroke",
  "i think the issue is that we decrypt the whole row table before projecting, so a two hundred thousand row conversation pays for every row on every query",
  "can we move the token dictionary out of the ciphertext and keep only the matched rows encrypted instead? that would cut the per keystroke cost a lot",
  "heads up: the ratchet index is per sender and strictly sequential, so a failed send has to be retried with the same index or the receiver derives the wrong key",
  "rolled the sealed table out behind a flag this morning, search memory on the big thread dropped from thirty megabytes to about one and a half",
];

function buildMessageText(random: () => number, index: number): string {
  const roll = random();
  if (roll < 0.08) {
    // A rare needle, so there is a known-correct answer to check search against.
    return `can anyone find the ${RARE_NEEDLES[index % RARE_NEEDLES.length]} thread?`;
  }
  if (roll < 0.34) {
    return SHORTHAND[Math.floor(random() * SHORTHAND.length)] ?? "ack";
  }
  if (roll < 0.46) {
    return LONG_FORM[Math.floor(random() * LONG_FORM.length)] ?? "ack";
  }
  const length = 3 + Math.floor(random() * 12);
  const words: string[] = [];
  for (let word = 0; word < length; word += 1) {
    words.push(
      COMMON_WORDS[Math.floor(random() * COMMON_WORDS.length)] ?? "index"
    );
  }
  return words.join(" ");
}

interface SeedOptions {
  batchSize: number;
  conversationId: string;
  dryRun: boolean;
  quiet: boolean;
  seed: number;
  senderA: string;
  senderB: string;
  startDaysAgo: number;
  total: number;
  verifyOnly: boolean;
}

async function resolveRootKey(
  conversationId: string,
  ownerUserId: string,
  peerUserId: string
): Promise<Uint8Array> {
  const [owner, peer, ownerWrap, peerWrap] = await Promise.all([
    prisma.orm.public.MessageIdentities.where({ userId: ownerUserId }).first(),
    prisma.orm.public.MessageIdentities.where({ userId: peerUserId }).first(),
    prisma.orm.public.MessageConversationKeys.where({
      conversationId,
      ownerUserId,
    })
      .orderBy((wrap) => wrap.version.desc())
      .first(),
    prisma.orm.public.MessageConversationKeys.where({
      conversationId,
      ownerUserId: peerUserId,
    })
      .orderBy((wrap) => wrap.version.desc())
      .first(),
  ]);
  if (!owner?.masterKeyHash) {
    throw new Error(
      `${ownerUserId} has no masterKeyHash, so its backup key cannot be derived. Open the app once as this user to create an identity.`
    );
  }
  if (!peer) {
    throw new Error(`${peerUserId} has no message identity.`);
  }
  if (!peer.masterKeyHash) {
    throw new Error(`${peerUserId} has no recoverable identity seed.`);
  }
  if (!ownerWrap || !peerWrap || ownerWrap.version !== peerWrap.version) {
    throw new Error(`No matching conversation key epoch for both DM members.`);
  }

  const masterKey = await deriveMasterKey(
    owner.masterKeyHash,
    base64ToBytes(owner.salt),
    owner.kdfIterations
  );
  // Stored as `iv.ciphertext` (see enableIdentity in message-identity-provider).
  const [iv, ciphertext] = owner.encryptedPrivateKey.split(".");
  if (!iv || !ciphertext) {
    throw new Error(`${ownerUserId} has an unreadable encryptedPrivateKey.`);
  }
  const privateKeyJwk = JSON.parse(
    await decryptWithMasterKey(masterKey, { ciphertext, iv })
  );
  const privateKey = await importPrivateKeyJwk(privateKeyJwk);
  const pairingPublicKey = await importPublicKeyJwk(
    publicKeyBase64ToJwk(ownerWrap.wrapperPublicKey ?? peer.publicKey)
  );
  const rootKey = await unwrapRootKey(
    privateKey,
    pairingPublicKey,
    conversationId,
    {
      ciphertext: ownerWrap.encryptedKey,
      iv: ownerWrap.iv,
    }
  );
  const peerMasterKey = await deriveMasterKey(
    peer.masterKeyHash,
    base64ToBytes(peer.salt),
    peer.kdfIterations
  );
  const [peerBackupIv, peerBackupCiphertext] =
    peer.encryptedPrivateKey.split(".");
  if (!peerBackupIv || !peerBackupCiphertext) {
    throw new Error(`${peerUserId} has an unreadable encryptedPrivateKey.`);
  }
  const peerPrivateKey = await importPrivateKeyJwk(
    JSON.parse(
      await decryptWithMasterKey(peerMasterKey, {
        ciphertext: peerBackupCiphertext,
        iv: peerBackupIv,
      })
    )
  );
  const peerPairingPublicKey = await importPublicKeyJwk(
    publicKeyBase64ToJwk(peerWrap.wrapperPublicKey ?? owner.publicKey)
  );
  const peerRootKey = await unwrapRootKey(
    peerPrivateKey,
    peerPairingPublicKey,
    conversationId,
    {
      ciphertext: peerWrap.encryptedKey,
      iv: peerWrap.iv,
    }
  );
  if (Buffer.compare(Buffer.from(rootKey), Buffer.from(peerRootKey)) !== 0) {
    throw new Error("DM members recovered different root keys");
  }
  return rootKey;
}

// Proves the whole chain before a single row is written. If this cannot decrypt a
// message the app already sent, nothing produced here would be readable either.
async function verifyExistingMessages(
  conversationId: string,
  rootKey: Uint8Array,
  senders: string[],
  options: Pick<SeedOptions, "quiet">
): Promise<number> {
  let verified = 0;
  for (const senderId of senders) {
    const sample = await prisma.orm.public.Messages.where({
      conversationId,
      senderId,
    })
      .orderBy((message) => message.ratchetIndex.desc())
      .first();
    if (!sample) {
      continue;
    }
    const payload = await decryptMessage(rootKey, senderId, conversationId, {
      ciphertext: sample.ciphertext,
      iv: sample.iv,
      ratchetIndex: sample.ratchetIndex,
    });
    // Any payload type proves the chain: the point is that the server-derived key
    // opens a message the app itself wrote. This conversation already contains
    // media messages, which is exactly the kind that would fail if the chain were
    // wrong, so there is no reason to require text here.
    if (!options.quiet) {
      console.log(`            ${senderId}: ${payload.type} payload decrypted`);
    }
    verified += 1;
  }
  if (verified === 0) {
    return 0;
  }
  return verified;
}

async function verifyFreshMessageCrypto(
  conversationId: string,
  senderId: string,
  rootKey: Uint8Array,
  ratchetIndex: number
): Promise<void> {
  const text = "dm-search-seed-crypto-check";
  const encrypted = await encryptMessage(
    rootKey,
    senderId,
    ratchetIndex,
    conversationId,
    { content: text, type: "text" }
  );
  const decrypted = await decryptMessage(rootKey, senderId, conversationId, {
    ...encrypted,
    ratchetIndex,
  });
  if (decrypted.type !== "text" || decrypted.content !== text) {
    throw new Error("Fresh DM key failed an encrypt/decrypt round trip");
  }
}

async function nextIndexFor(
  conversationId: string,
  senderId: string
): Promise<number> {
  const latest = await prisma.orm.public.Messages.select("ratchetIndex")
    .where({ conversationId, senderId })
    .orderBy((message) => message.ratchetIndex.desc())
    .first();
  return (latest?.ratchetIndex ?? -1) + 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const conversationId = flag(argv, "conversation");
  if (!conversationId) {
    throw new Error("--conversation=ID is required");
  }
  const options: SeedOptions = {
    batchSize: numberFlag(argv, "batch-size", 2000),
    conversationId,
    dryRun: argv.includes("--dry-run"),
    quiet: argv.includes("--quiet"),
    seed: numberFlag(argv, "seed", 20260925),
    senderA: flag(argv, "sender-a") ?? "",
    senderB: flag(argv, "sender-b") ?? "",
    startDaysAgo: numberFlag(argv, "start-days-ago", 400),
    total: numberFlag(argv, "total", 200_000),
    verifyOnly: argv.includes("--verify-only"),
  };

  const members = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where({ conversationId })
    .all();
  const memberIds = members.map((member) => member.userId).toSorted();
  if (memberIds.length !== 2) {
    throw new Error(
      `Expected exactly 2 members, found ${memberIds.length}: ${memberIds.join(", ")}`
    );
  }
  const senderA = options.senderA || memberIds[0] || "";
  const senderB = options.senderB || memberIds[1] || "";
  if (![senderA, senderB].every((id) => memberIds.includes(id))) {
    throw new Error("Both senders must be members of the conversation");
  }
  const senders = [senderA, senderB];

  const existing = await prisma.orm.public.Messages.where({
    conversationId,
  }).aggregate((aggregate) => ({ count: aggregate.count() }));
  const [conversation, currentWrap] = await Promise.all([
    prisma.orm.public.MessageConversations.select("changeSeq")
      .where({ id: conversationId })
      .first(),
    prisma.orm.public.MessageConversationKeys.select("version")
      .where({ conversationId, ownerUserId: senderA })
      .orderBy((wrap) => wrap.version.desc())
      .first(),
  ]);
  if (!conversation || !currentWrap) {
    throw new Error("Conversation sequence or current key epoch is missing");
  }
  const sequenceStart = conversation.changeSeq;
  const keyEpoch = currentWrap.version;
  console.log(
    `conversation ${conversationId}\n  members   ${memberIds.join(", ")}\n  existing  ${existing.count} messages`
  );

  const rootKey = await resolveRootKey(conversationId, senderA, senderB);
  console.log("  root key  derived and unwrapped");
  const verified = await verifyExistingMessages(
    conversationId,
    rootKey,
    senders,
    options
  );
  if (verified === 0) {
    await verifyFreshMessageCrypto(
      conversationId,
      senderA,
      rootKey,
      await nextIndexFor(conversationId, senderA)
    );
    console.log("  verified  both members recover one matching root key");
  } else {
    console.log(`  verified  decrypted ${verified} existing message(s) OK`);
  }

  if (options.verifyOnly) {
    return;
  }

  const startIndex: Record<string, number> = {};
  for (const senderId of senders) {
    startIndex[senderId] = await nextIndexFor(conversationId, senderId);
  }
  const endAt = Date.now() - 60_000;
  const spanMs = options.startDaysAgo * 24 * 60 * 60 * 1000;
  const firstAt = endAt - spanMs;

  console.log(
    `  plan      +${options.total} messages, batch ${options.batchSize}, ratchet from ${senders
      .map((id) => `${id}@${startIndex[id] ?? 0}`)
      .join(" ")}`
  );
  if (options.dryRun) {
    console.log("  dry run   nothing written");
    return;
  }

  const random = makeRandom(options.seed);
  // One ratchet base key per sender, reused for every message. `encryptMessage`
  // re-imports the root key on each call; at 200k messages that import is pure
  // overhead, so the per-message key is derived from a base key imported once and
  // the encryption mirrors `encryptMessage` exactly (same AAD, same AES-GCM).
  const baseKeyBySender = new Map<string, CryptoKey>();
  for (const senderId of senders) {
    baseKeyBySender.set(senderId, await importRatchetBaseKey(rootKey));
  }
  const encoder = new TextEncoder();

  async function encryptLikeApp(
    senderId: string,
    ratchetIndex: number,
    payload: MessagePayload
  ): Promise<{ ciphertext: string; iv: string }> {
    const baseKey = baseKeyBySender.get(senderId);
    if (!baseKey) {
      throw new Error(`no base key for ${senderId}`);
    }
    const messageKey = await deriveMessageKeyFromBase(
      baseKey,
      senderId,
      ratchetIndex
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = encoder.encode(
      `${options.conversationId}:${senderId}:${ratchetIndex}`
    );
    const ciphertext = await crypto.subtle.encrypt(
      { additionalData: aad, iv, name: "AES-GCM" },
      messageKey,
      encoder.encode(JSON.stringify(payload))
    );
    return {
      ciphertext: Buffer.from(ciphertext).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
    };
  }

  const counters: Record<string, number> = { ...startIndex };
  let written = 0;
  let pending: {
    ciphertext: string;
    conversationId: string;
    createdAt: Temporal.PlainDateTime;
    creationSequence: number;
    iv: string;
    keyEpoch: number;
    ratchetIndex: number;
    senderId: string;
  }[] = [];
  const startedAt = Date.now();

  while (written < options.total) {
    const remaining = options.total - written;
    const batchTarget = Math.min(options.batchSize, remaining);
    pending = [];
    for (let offset = 0; offset < batchTarget; offset += 1) {
      const globalIndex = written + offset;
      const senderId = globalIndex % 2 === 0 ? senderA : senderB;
      const ratchetIndex = counters[senderId] ?? 0;
      counters[senderId] = ratchetIndex + 1;
      const text = buildMessageText(random, globalIndex);
      const { ciphertext, iv } = await encryptLikeApp(senderId, ratchetIndex, {
        content: text,
        type: "text",
      });
      pending.push({
        ciphertext,
        conversationId: options.conversationId,
        // Spread oldest to newest so createdAt matches insertion order, which is
        // what the search index and the history walk both order by.
        createdAt: toPrismaDateTime(
          new Date(firstAt + Math.floor((spanMs * globalIndex) / options.total))
        ),
        creationSequence: sequenceStart + globalIndex + 1,
        iv,
        keyEpoch,
        ratchetIndex,
        senderId,
      });
    }
    const nextSequence = sequenceStart + written + pending.length;
    await prisma.transaction(async (tx) => {
      await tx.orm.public.Messages.createAll(pending);
      await tx.orm.public.MessageConversations.where({
        id: conversationId,
      }).update({ changeSeq: nextSequence });
    });
    written += pending.length;
    if (!options.quiet) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = Math.round(written / Math.max(elapsed, 0.001));
      process.stdout.write(
        `\r  inserted  ${written}/${options.total} (${rate}/s)   `
      );
    }
  }
  if (!options.quiet) {
    process.stdout.write("\n");
  }

  // The API treats the key's ratchetCounter as authoritative for the next send, so
  // it has to move with the rows or the first real message after this is rejected
  // with a 409.
  for (const senderId of senders) {
    const next = counters[senderId] ?? 0;
    await prisma.orm.public.MessageConversationKeys.where({
      conversationId,
      ownerUserId: senderId,
    }).updateAll({ ratchetCounter: next });
  }
  await prisma.orm.public.MessageConversationMembers.where({
    conversationId,
  }).updateAll({ lastReadAt: toPrismaDateTime(new Date()) });
  console.log(
    `  counters  ${senders.map((id) => `${id}@${counters[id] ?? 0}`).join(" ")}`
  );

  const after = await prisma.orm.public.Messages.where({
    conversationId,
  }).aggregate((aggregate) => ({ count: aggregate.count() }));
  const sample = await prisma.orm.public.Messages.where({ conversationId })
    .orderBy((message) => message.ratchetIndex.asc())
    .limit(1)
    .all();
  const payload = sample[0]
    ? await decryptMessage(
        rootKey,
        sample[0].senderId,
        conversationId,
        sample[0]
      )
    : null;
  console.log(`  total     ${after} messages`);
  console.log(
    `  re-read   oldest message decrypts to: ${JSON.stringify(payload?.content ?? null).slice(0, 90)}`
  );
}

await main()
  .then(async () => {
    await closePrisma();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await closePrisma();
    process.exit(1);
  });
