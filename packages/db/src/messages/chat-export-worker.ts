import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, closeSync, openSync, writeSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
import {
  requireLifecycleValue,
  extractMessageReferences,
  incognitoNotice,
} from "@asm/messages";
import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  publicKeyBase64ToJwk,
  unwrapRootKey,
} from "@asm/messages/crypto";
import type { MessagePayload } from "@asm/messages/crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { and, or } from "@prisma/orm-postgres/orm-client";
import { Zip, ZipPassThrough } from "fflate";

import { fromPrismaDateTime, toPrismaDateTime } from "../dates";
import prisma from "../prisma";
import { ASMOB_BUCKET, asmobClient, deleteObject } from "../storage";
import { visibleToUser } from "./access/visibility";
import {
  assertChatExportScope,
  chatExportWindows,
  claimChatExport,
} from "./chat-export";
import type { ChatExportJob } from "./chat-export";
import { rawExecute } from "./infrastructure/raw-sql";
import {
  chatLifecycleSnapshot,
  ChatLifecycleError,
  lifecycleMediaAllowed,
} from "./lifecycle";

const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;
const MAX_EXPORT_MEDIA = 10_000;
const encoder = new TextEncoder();

async function viewerDecryptor(job: ChatExportJob) {
  const identity = await prisma.orm.public.MessageIdentities.where({
    userId: job.userId,
  }).first();
  if (
    !identity?.masterKeyHash ||
    identity.kdfIterations < 100_000 ||
    identity.kdfIterations > 5_000_000
  ) {
    throw new ChatLifecycleError("EXPORT_IDENTITY_UNAVAILABLE");
  }
  const [iv, ciphertext] = identity.encryptedPrivateKey.split(".");
  if (!iv || !ciphertext) {
    throw new ChatLifecycleError("EXPORT_IDENTITY_UNAVAILABLE");
  }
  const master = await deriveMasterKey(
    identity.masterKeyHash,
    Uint8Array.from(Buffer.from(identity.salt, "base64")),
    identity.kdfIterations
  );
  const jwk: JsonWebKey = JSON.parse(
    await decryptWithMasterKey(master, { ciphertext, iv })
  );
  const publicJwk = publicKeyBase64ToJwk(identity.publicKey);
  if (jwk.x !== publicJwk.x || jwk.y !== publicJwk.y) {
    throw new ChatLifecycleError("EXPORT_IDENTITY_UNAVAILABLE");
  }
  const privateKey = await importPrivateKeyJwk(jwk);
  const wraps = await prisma.orm.public.MessageConversationKeys.where({
    conversationId: job.conversationId,
    ownerUserId: job.userId,
  })
    .orderBy((k) => k.version.desc())
    .limit(2048)
    .all();
  const members = await prisma.orm.public.MessageConversationMembers.select(
    "userId"
  )
    .where({ conversationId: job.conversationId })
    .all();
  const roots = new Map<number, Uint8Array>();
  const failures = new Set<number>();
  return async (message: {
    senderId: string;
    keyEpoch: number | null;
    ciphertext: string;
    iv: string;
    ratchetIndex: number;
  }): Promise<MessagePayload | null> => {
    const candidates =
      message.keyEpoch === null
        ? wraps
        : wraps.filter((w) => w.version === message.keyEpoch);
    for (const wrap of candidates) {
      if (failures.has(wrap.version)) {
        continue;
      }
      try {
        let root = roots.get(wrap.version);
        if (!root) {
          let { wrapperPublicKey } = wrap;
          if (!wrapperPublicKey) {
            const wrapperId =
              wrap.wrapperUserId ??
              (members.length === 2
                ? members.find((m) => m.userId !== job.userId)?.userId
                : undefined);
            if (!wrapperId) {
              failures.add(wrap.version);
              continue;
            }
            const awaitedChatState0 =
              await prisma.orm.public.MessageIdentities.where({
                userId: wrapperId,
              }).first();
            wrapperPublicKey = awaitedChatState0?.publicKey ?? null;
          }
          if (!wrapperPublicKey) {
            failures.add(wrap.version);
            continue;
          }
          root = await unwrapRootKey(
            privateKey,
            await importPublicKeyJwk(publicKeyBase64ToJwk(wrapperPublicKey)),
            job.conversationId,
            { ciphertext: wrap.encryptedKey, iv: wrap.iv }
          );
          if (roots.size >= 64) {
            roots.delete(requireLifecycleValue(roots.keys().next().value));
          }
          roots.set(wrap.version, root);
        }
        return await decryptMessage(
          root,
          message.senderId,
          job.conversationId,
          message
        );
      } catch {
        // Reconcile safely on the next request; do not expose source errors.
        // A damaged message does not invalidate the root for other messages.
      }
    }
    return null;
  };
}

function exportText(payload: MessagePayload | null): string {
  if (!payload) {
    return "[Message unavailable: this account cannot decrypt this history]";
  }
  if (payload.type === "post") {
    return `${payload.content ?? ""} [Shared post: ${payload.postId}]`;
  }
  if (payload.type === "media") {
    // Version-2 attachments label themselves by kind. A view-once photo is
    // named but never given a URL or a reference, so the export can never
    // fetch its bytes; the media download below skips it for the same reason.
    if ("attachments" in payload) {
      const entries = payload.attachments.map((attachment) => {
        if (attachment.kind === "view-once") {
          return "Photo: view once";
        }
        if (attachment.kind === "file") {
          return `File: ${attachment.filename}`;
        }
        return attachment.url;
      });
      return `${payload.content ?? ""} [Media: ${entries.join(", ")}]`;
    }
    return `${payload.content ?? ""} [Media: ${extractMessageReferences(payload)
      .filter((r) => r.kind === "media")
      .map((r) => r.url ?? "")
      .join(", ")}]`;
  }
  return payload.content;
}

async function encryptedZip(
  directory: string,
  files: { name: string; path: string }[],
  key: Uint8Array
): Promise<string> {
  const target = nodePath.join(directory, "archive.enc");
  const descriptor = openSync(target, "wx", 0o600);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let bytes = 28;
  writeSync(descriptor, Buffer.alloc(28));
  const zip = new Zip((requestFailure, chunk) => {
    if (requestFailure) {
      throw requestFailure;
    }
    bytes += chunk.byteLength;
    if (bytes > MAX_EXPORT_BYTES) {
      throw new ChatLifecycleError("EXPORT_TOO_LARGE", 413);
    }
    writeSync(descriptor, cipher.update(chunk));
  });
  try {
    for (const file of files) {
      const entry = new ZipPassThrough(file.name);
      zip.add(entry);
      for await (const chunk of createReadStream(file.path, {
        highWaterMark: 64 * 1024,
      })) {
        entry.push(new Uint8Array(chunk));
      }
      entry.push(new Uint8Array(), true);
    }
    zip.end();
    writeSync(descriptor, cipher.final());
    writeSync(descriptor, Buffer.concat([iv, cipher.getAuthTag()]), 0, 28, 0);
  } finally {
    closeSync(descriptor);
  }
  return target;
}

export interface ChatExportStorage {
  read: (key: string) => Promise<AsyncIterable<Uint8Array> | null>;
  write: (key: string, path: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  erasePrefix: (prefix: string) => Promise<boolean>;
}
const defaultStorage: ChatExportStorage = {
  async erasePrefix(prefix) {
    const page = await asmobClient.send(
      new ListObjectsV2Command({
        Bucket: ASMOB_BUCKET,
        MaxKeys: 100,
        Prefix: prefix,
      })
    );
    await Promise.all(
      (page.Contents ?? []).map((object) =>
        object.Key ? deleteObject(object.Key) : Promise.resolve()
      )
    );
    return !page.IsTruncated;
  },
  async read(key) {
    const object = await asmobClient.send(
      new GetObjectCommand({ Bucket: ASMOB_BUCKET, Key: key })
    );
    return object.Body ? (object.Body as AsyncIterable<Uint8Array>) : null;
  },
  remove: deleteObject,
  async write(key, path) {
    const awaitedChatState1 = await stat(path);
    await asmobClient.send(
      new PutObjectCommand({
        Body: createReadStream(path),
        Bucket: ASMOB_BUCKET,
        CacheControl: "no-store",
        ContentLength: awaitedChatState1.size,
        ContentType: "application/octet-stream",
        Key: key,
      })
    );
  },
};

export async function processNextChatExport(
  storage: ChatExportStorage = defaultStorage,
  jobId?: string
): Promise<boolean> {
  const job = await claimChatExport(jobId);
  if (!job) {
    return false;
  }
  const directory = await mkdtemp(nodePath.join(tmpdir(), "asm-chat-export-"));
  let uploadedKey: string | null = null;
  try {
    await assertChatExportScope(
      job.id,
      job.userId,
      job.conversationId,
      job.artifactKey ?? undefined
    );
    const windows = await chatExportWindows(job);
    const decrypt = await viewerDecryptor(job);
    const jsonPath = nodePath.join(directory, "chat.json");
    const txtPath = nodePath.join(directory, "chat.txt");
    await writeFile(jsonPath, '{"format":"asocialmedia-chat-v1","messages":[', {
      mode: 0o600,
    });
    await writeFile(
      txtPath,
      `Asocialmedia chat export\nConversation: ${job.conversationId}\nTimes are UTC. Incognito message content is excluded.\n\n`,
      { mode: 0o600 }
    );
    let cursor:
      | { id: string; createdAt: ReturnType<typeof toPrismaDateTime> }
      | undefined;
    let first = true;
    let totalBytes = 0;
    let deadline = fromPrismaDateTime(job.expiresAt).getTime();
    const mediaIds = new Map<string, string>();
    while (true) {
      await assertChatExportScope(
        job.id,
        job.userId,
        job.conversationId,
        job.artifactKey ?? undefined
      );
      let query = prisma.orm.public.Messages.include("sender", (sender) =>
        sender.select("displayName", "username")
      )
        .where({ conversationId: job.conversationId })
        .where(visibleToUser(job.userId))
        .where((m) =>
          and(
            m.deletedAt.isNull(),
            m.creationSequence.lte(job.snapshotSequence),
            m.createdAt.lte(job.createdAt)
          )
        )
        .where((m) =>
          or(
            ...windows.map((w) => {
              const bounds = [];
              if (w.after) {
                bounds.push(m.createdAt.gte(toPrismaDateTime(w.after)));
              }
              if (w.before) {
                bounds.push(m.createdAt.lte(toPrismaDateTime(w.before)));
              }
              return bounds.length
                ? and(...bounds)
                : m.conversationId.eq(job.conversationId);
            })
          )
        )
        .orderBy([(m) => m.createdAt.asc(), (m) => m.id.asc()]);
      if (job.fromDate) {
        query = query.where((m) =>
          m.createdAt.gte(requireLifecycleValue(job.fromDate))
        );
      }
      if (job.toDate) {
        query = query.where((m) =>
          m.createdAt.lte(requireLifecycleValue(job.toDate))
        );
      }
      if (cursor) {
        query = query.cursor(cursor);
      }
      const messages = await query.limit(100).all();
      if (!messages.length) {
        break;
      }
      for (const message of messages) {
        const payload = await decrypt(message);
        const record = JSON.stringify({
          createdAt: fromPrismaDateTime(message.createdAt).toISOString(),
          editedAt: message.editedAt
            ? fromPrismaDateTime(message.editedAt).toISOString()
            : null,
          id: message.id,
          payload,
          senderId: message.senderId,
          senderName: message.sender?.displayName ?? "Deleted account",
          unavailable: payload === null,
        });
        const text = `${fromPrismaDateTime(message.createdAt).toISOString()} ${message.sender?.displayName ?? "Deleted account"}: ${exportText(payload)}\n`;
        totalBytes += encoder.encode(record + text).byteLength;
        if (totalBytes > MAX_EXPORT_BYTES) {
          throw new ChatLifecycleError("EXPORT_TOO_LARGE", 413);
        }
        await appendFile(jsonPath, `${first ? "" : ","}${record}`);
        await appendFile(txtPath, text);
        first = false;
        if (message.expiresAt) {
          deadline = Math.min(
            deadline,
            fromPrismaDateTime(message.expiresAt).getTime()
          );
        }
        if (payload && job.includeMedia) {
          for (const ref of extractMessageReferences(payload)) {
            if (ref.kind === "media" && ref.requiredId) {
              mediaIds.set(ref.requiredId, message.id);
              if (mediaIds.size > MAX_EXPORT_MEDIA) {
                throw new ChatLifecycleError("EXPORT_TOO_LARGE", 413);
              }
            }
          }
        }
      }
      const last = requireLifecycleValue(messages.at(-1));
      cursor = { createdAt: last.createdAt, id: last.id };
      await rawExecute(
        `UPDATE public.message_export_jobs SET "leaseUntil"=clock_timestamp()+interval '5 minutes',"expiresAt"=LEAST("expiresAt",$2::timestamp) WHERE id=$1 AND status='processing' AND "artifactKey"=$3`,
        [job.id, new Date(deadline), job.artifactKey]
      );
    }
    await appendFile(jsonPath, '],"systemEvents":[');
    let noticeCursor: string | undefined;
    let firstNotice = true;
    do {
      const snapshot = await chatLifecycleSnapshot(
        job.conversationId,
        job.userId,
        noticeCursor
      );
      for (const notice of snapshot.notices) {
        const started = Date.parse(notice.startedAt);
        if (
          started > fromPrismaDateTime(job.createdAt).getTime() ||
          (job.fromDate &&
            started < fromPrismaDateTime(job.fromDate).getTime()) ||
          (job.toDate && started > fromPrismaDateTime(job.toDate).getTime())
        ) {
          continue;
        }
        await appendFile(
          jsonPath,
          `${firstNotice ? "" : ","}${JSON.stringify({ endReason: notice.endReason, endedAt: notice.endedAt, endedById: notice.endedById, endedByName: notice.endedByName, id: notice.id, startedAt: notice.startedAt, startedById: notice.startedById, startedByName: notice.startedByName, text: incognitoNotice(notice) })}`
        );
        await appendFile(
          txtPath,
          `[System] ${notice.startedAt} ${incognitoNotice(notice)}\n`
        );
        firstNotice = false;
      }
      noticeCursor = snapshot.nextNoticeCursor ?? undefined;
    } while (noticeCursor);
    await appendFile(jsonPath, "]}");
    const files = [
      { name: "chat.json", path: jsonPath },
      { name: "chat.txt", path: txtPath },
    ];
    for (const [id, sourceId] of mediaIds) {
      await assertChatExportScope(
        job.id,
        job.userId,
        job.conversationId,
        job.artifactKey ?? undefined
      );
      const media = await prisma.orm.public.PostMedia.where({
        id,
        messageConversationId: job.conversationId,
      }).first();
      const linked = await prisma.orm.public.MessageMediaLinks.where({
        mediaId: id,
        messageId: sourceId,
      }).first();
      if (
        !media ||
        media.status !== "READY" ||
        !linked ||
        !(await lifecycleMediaAllowed(id, job.userId))
      ) {
        continue;
      }
      const key = media.publishedKey || media.key;
      if (!key || media.size > 50 * 1024 * 1024) {
        continue;
      }
      const body = await storage.read(key);
      if (!body) {
        continue;
      }
      const path = nodePath.join(directory, `media-${id}`);
      const fd = openSync(path, "wx", 0o600);
      try {
        for await (const chunk of body) {
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_EXPORT_BYTES) {
            throw new ChatLifecycleError("EXPORT_TOO_LARGE", 413);
          }
          writeSync(fd, chunk);
        }
      } finally {
        closeSync(fd);
      }
      files.push({ name: `media/${id}`, path });
    }
    const artifactKey = Buffer.from(
      requireLifecycleValue(job.artifactKey),
      "base64"
    );
    const archive = await encryptedZip(directory, files, artifactKey);
    await assertChatExportScope(
      job.id,
      job.userId,
      job.conversationId,
      job.artifactKey ?? undefined
    );
    uploadedKey = `private/chat-exports/${job.id}/${randomBytes(16).toString("hex")}.enc`;
    await prisma.orm.public.MessageExportJobs.where({
      artifactKey: job.artifactKey,
      id: job.id,
      status: "processing",
    }).update({ objectKey: uploadedKey });
    await storage.write(uploadedKey, archive);
    await assertChatExportScope(
      job.id,
      job.userId,
      job.conversationId,
      job.artifactKey ?? undefined
    );
    const updated = await prisma.orm.public.MessageExportJobs.where({
      artifactKey: job.artifactKey,
      id: job.id,
      status: "processing",
    }).updateAndCount({
      artifactKey: artifactKey.toString("base64"),
      leaseUntil: null,
      objectKey: uploadedKey,
      status: "ready",
    });
    if (!updated) {
      await storage.remove(uploadedKey);
      uploadedKey = null;
    }
  } catch (error) {
    if (uploadedKey) {
      await storage.remove(uploadedKey).catch(() => {
        // The durable artifact pointer allows the periodic cleanup to retry.
      });
    }
    await prisma.orm.public.MessageExportJobs.where({
      artifactKey: job.artifactKey,
      id: job.id,
      status: "processing",
    }).update({
      errorCode:
        error instanceof ChatLifecycleError ? error.code : "EXPORT_UNAVAILABLE",
      leaseUntil: null,
      status: "failed",
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  return true;
}

export async function getChatExportStream(
  job: ChatExportJob,
  storage: ChatExportStorage = defaultStorage
): Promise<ReadableStream<Uint8Array>> {
  if (job.status !== "ready" || !job.objectKey || !job.artifactKey) {
    throw new ChatLifecycleError("EXPORT_NOT_READY");
  }
  const body = await storage.read(job.objectKey);
  if (!body) {
    throw new ChatLifecycleError("EXPORT_UNAVAILABLE", 503);
  }
  const iterator = decryptExport(
    body,
    Buffer.from(job.artifactKey, "base64"),
    fromPrismaDateTime(job.expiresAt).getTime()
  );
  return new ReadableStream<Uint8Array>({
    async cancel() {
      await iterator.return();
    },
    async pull(controller) {
      try {
        await assertChatExportScope(job.id, job.userId, job.conversationId);
        const next = await iterator.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch {
        controller.error(
          new Error("Download interrupted. Request a fresh export.")
        );
      }
    },
  });
}

async function* decryptExport(
  source: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  deadline: number
) {
  let header = Buffer.alloc(0);
  let decipher: ReturnType<typeof createDecipheriv> | undefined;
  for await (const chunk of source) {
    if (Date.now() >= deadline) {
      throw new ChatLifecycleError("EXPORT_EXPIRED", 410);
    }
    let body = Buffer.from(chunk);
    if (!decipher) {
      header = Buffer.concat([header, body]);
      if (header.length < 28) {
        continue;
      }
      const authenticated = createDecipheriv(
        "aes-256-gcm",
        key,
        header.subarray(0, 12)
      );
      authenticated.setAuthTag(header.subarray(12, 28));
      decipher = authenticated;
      body = header.subarray(28);
      header = Buffer.alloc(0);
    }
    const plaintext = decipher.update(body);
    if (plaintext.length) {
      yield new Uint8Array(plaintext);
    }
  }
  if (!decipher) {
    throw new Error("Invalid archive");
  }
  const tail = decipher.final();
  if (tail.length) {
    yield new Uint8Array(tail);
  }
}

export async function eraseExpiredChatExports(
  storage: ChatExportStorage = defaultStorage,
  jobId?: string
): Promise<void> {
  let query = prisma.orm.public.MessageExportJobs.where((j) =>
    or(
      j.expiresAt.lte(toPrismaDateTime(new Date())),
      j.status.in(["revoked", "cancelled"])
    )
  );
  if (jobId) {
    query = query.where({ id: jobId });
  }
  const jobs = await query
    .orderBy((j) => j.createdAt.asc())
    .limit(50)
    .all();
  let failures = 0;
  for (const job of jobs) {
    try {
      if (job.objectKey) {
        await storage.remove(job.objectKey);
      }
      if (!(await storage.erasePrefix(`private/chat-exports/${job.id}/`))) {
        continue;
      }
      await prisma.orm.public.MessageExportJobs.where({
        id: job.id,
      }).deleteAndCount();
    } catch {
      failures += 1;
    }
  }
  if (failures > 0) {
    throw new Error("Chat export cleanup unavailable");
  }
}
