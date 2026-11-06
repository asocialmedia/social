import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import { requireLifecycleValue } from "@asm/messages";
import {
  deriveMasterKey,
  encryptMessage,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateIdentityKeyPair,
  generateRootKey,
  publicKeyJwkToBase64,
  wrapRootKey,
} from "@asm/messages/crypto";
import { unzipSync } from "fflate";

import { keys } from "../../keys";
import { fromPrismaDateTime, toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import {
  assertChatExportScope,
  claimChatExport,
  requestChatExport,
} from "./chat-export";
import {
  eraseExpiredChatExports,
  getChatExportStream,
  processNextChatExport,
} from "./chat-export-worker";
import type { ChatExportStorage } from "./chat-export-worker";
import { clearChatHistory, endIncognito, startIncognito } from "./lifecycle";

const owner = `export-owner-${crypto.randomUUID()}`;
const peer = `export-peer-${crypto.randomUUID()}`;
const conversationId = crypto.randomUUID();
const objects = new Map<string, Uint8Array>();
const storage: ChatExportStorage = {
  erasePrefix(prefix) {
    for (const key of objects.keys()) {
      if (key.startsWith(prefix)) {
        objects.delete(key);
      }
    }
    return Promise.resolve(true);
  },
  read(key) {
    const bytes = objects.get(key);
    if (!bytes) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      (async function* read() {
        // Split the authenticated header across chunks to exercise network framing.
        yield bytes.subarray(0, 7);
        yield bytes.subarray(7, 19);
        yield bytes.subarray(19);
      })()
    );
  },
  remove(key) {
    objects.delete(key);
    return Promise.resolve();
  },
  async write(key, path) {
    objects.set(key, new Uint8Array(await readFile(path)));
  },
};

beforeAll(async () => {
  const url = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "5433" ||
    url.pathname !== "/asocialmedia"
  ) {
    throw new Error("Local development database required");
  }
  await prisma.orm.public.Users.createAll(
    [owner, peer].map((id) => ({ displayName: id, id, username: id }))
  );
  await prisma.orm.public.MessageConversations.create({
    changeSeq: 3,
    id: conversationId,
  });
  await prisma.orm.public.MessageConversationMembers.createAll(
    [owner, peer].map((userId) => ({ conversationId, userId }))
  );
  const [identity, wrapper] = await Promise.all([
    generateIdentityKeyPair(),
    generateIdentityKeyPair(),
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const masterKeyHash = "a".repeat(64);
  const master = await deriveMasterKey(masterKeyHash, salt, 100_000);
  const backup = await encryptWithMasterKey(
    master,
    JSON.stringify(await exportPrivateKeyJwk(identity.privateKey))
  );
  await prisma.orm.public.MessageIdentities.create({
    encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    kdfIterations: 100_000,
    masterKeyHash,
    publicKey: publicKeyJwkToBase64(
      await exportPublicKeyJwk(identity.publicKey)
    ),
    salt: Buffer.from(salt).toString("base64"),
    userId: owner,
  });
  const root = generateRootKey();
  const wrap = await wrapRootKey(
    wrapper.privateKey,
    identity.publicKey,
    conversationId,
    root
  );
  await prisma.orm.public.MessageConversationKeys.create({
    conversationId,
    encryptedKey: wrap.ciphertext,
    iv: wrap.iv,
    ownerUserId: owner,
    version: 1,
    wrapperPublicKey: publicKeyJwkToBase64(
      await exportPublicKeyJwk(wrapper.publicKey)
    ),
  });
  for (const [index, text] of [
    "retained export content",
    "expired export content",
    "unreadable epoch",
  ].entries()) {
    const encrypted = await encryptMessage(root, peer, index, conversationId, {
      content: text,
      type: "text",
    });
    await prisma.orm.public.Messages.create({
      ...encrypted,
      conversationId,
      creationSequence: index + 1,
      expiresAt:
        index === 1 ? toPrismaDateTime(new Date(Date.now() - 1000)) : null,
      keyEpoch: index === 2 ? 2 : 1,
      senderId: peer,
    });
  }
  await startIncognito(conversationId, owner);
  const session = await prisma.orm.public.MessageIncognitoSessions.where({
    conversationId,
  }).first();
  await endIncognito(conversationId, peer, requireLifecycleValue(session).id);
});

afterAll(async () => {
  await prisma.orm.public.MessageConversations.where({
    id: conversationId,
  }).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in([owner, peer])
  ).deleteAndCount();
});

test("export produces an authenticated TXT/JSON ZIP with only retained readable history and usage metadata", async () => {
  const status = await requestChatExport(conversationId, owner, {
    includeMedia: false,
  });
  expect(await processNextChatExport(storage, status.id)).toBe(true);
  const job = await assertChatExportScope(status.id, owner, conversationId);
  expect(job.status).toBe("ready");
  const stream = await getChatExportStream(job, storage);
  const zip = unzipSync(
    new Uint8Array(await new Response(stream).arrayBuffer())
  );
  const text = new TextDecoder().decode(zip["chat.txt"]);
  const json = new TextDecoder().decode(zip["chat.json"]);
  expect(text).toContain("retained export content");
  expect(text).not.toContain("expired export content");
  expect(text).not.toContain("unreadable epoch");
  expect(text).toContain("Message unavailable");
  const data = JSON.parse(json) as {
    messages: unknown[];
    systemEvents: { startedById: string }[];
  };
  expect(data.messages).toHaveLength(2);
  expect(data.systemEvents[0]?.startedById).toBe(owner);
  expect(fromPrismaDateTime(job.expiresAt).getTime()).toBeLessThanOrEqual(
    Date.now() + 60 * 60 * 1000
  );
  await expect(
    assertChatExportScope(status.id, peer, conversationId)
  ).rejects.toMatchObject({ status: 404 });
});

test("storage failure is sanitized and does not publish a ready artifact", async () => {
  const status = await requestChatExport(conversationId, owner, {
    includeMedia: false,
  });
  await processNextChatExport(
    {
      ...storage,
      write() {
        throw new Error("private-storage-secret");
      },
    },
    status.id
  );
  const job = await prisma.orm.public.MessageExportJobs.where({
    id: status.id,
  }).first();
  expect(job?.status).toBe("failed");
  expect(job?.errorCode).toBe("EXPORT_UNAVAILABLE");
});

test("clearing revokes a previously generated export and leaves the peer history intact", async () => {
  const job = await prisma.orm.public.MessageExportJobs.where({
    conversationId,
    status: "ready",
  }).first();
  expect(job).not.toBeNull();
  await clearChatHistory(conversationId, owner, 3);
  await expect(
    assertChatExportScope(requireLifecycleValue(job).id, owner, conversationId)
  ).rejects.toMatchObject({ status: 410 });
  expect(
    await prisma.orm.public.Messages.where({ conversationId }).all()
  ).toHaveLength(3);
});

test("expiry erases orphaned attempt files as well as the published artifact", async () => {
  const status = await requestChatExport(conversationId, owner, {
    includeMedia: false,
  });
  const orphan = `private/chat-exports/${status.id}/interrupted-attempt.enc`;
  objects.set(orphan, new Uint8Array([1, 2, 3]));
  await prisma.orm.public.MessageExportJobs.where({ id: status.id }).update({
    expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)),
  });
  await eraseExpiredChatExports(storage, status.id);
  expect(objects.has(orphan)).toBe(false);
  expect(
    await prisma.orm.public.MessageExportJobs.where({ id: status.id }).first()
  ).toBeNull();
});

test("incomplete object cleanup keeps the durable job for retry", async () => {
  const status = await requestChatExport(conversationId, owner, {
    includeMedia: false,
  });
  await prisma.orm.public.MessageExportJobs.where({ id: status.id }).update({
    expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)),
  });
  await eraseExpiredChatExports(
    { ...storage, erasePrefix: () => Promise.resolve(false) },
    status.id
  );
  expect(
    await prisma.orm.public.MessageExportJobs.where({ id: status.id }).first()
  ).not.toBeNull();
  await eraseExpiredChatExports(storage, status.id);
  expect(
    await prisma.orm.public.MessageExportJobs.where({ id: status.id }).first()
  ).toBeNull();
});

test("a reclaimed export lease rejects a stale attempt token", async () => {
  const status = await requestChatExport(conversationId, owner, {
    includeMedia: false,
  });
  const first = requireLifecycleValue(await claimChatExport(status.id));
  await prisma.orm.public.MessageExportJobs.where({ id: status.id }).update({
    leaseUntil: toPrismaDateTime(new Date(Date.now() - 1000)),
  });
  const second = requireLifecycleValue(await claimChatExport(status.id));
  expect(second.artifactKey).not.toBe(first.artifactKey);
  await expect(
    assertChatExportScope(
      status.id,
      owner,
      conversationId,
      requireLifecycleValue(first.artifactKey)
    )
  ).rejects.toMatchObject({ code: "EXPORT_LEASE_LOST" });
  const current = await assertChatExportScope(
    status.id,
    owner,
    conversationId,
    requireLifecycleValue(second.artifactKey)
  );
  expect(current.status).toBe("processing");
});

test("storage deletion failure preserves the export cleanup record", async () => {
  const status = await requestChatExport(conversationId, owner, {
    includeMedia: false,
  });
  await prisma.orm.public.MessageExportJobs.where({ id: status.id }).update({
    expiresAt: toPrismaDateTime(new Date(Date.now() - 1000)),
  });
  await expect(
    eraseExpiredChatExports(
      {
        ...storage,
        erasePrefix: () => Promise.reject(new Error("private storage failure")),
      },
      status.id
    )
  ).rejects.toThrow("Chat export cleanup unavailable");
  expect(
    await prisma.orm.public.MessageExportJobs.where({ id: status.id }).first()
  ).not.toBeNull();
  await eraseExpiredChatExports(storage, status.id);
});
