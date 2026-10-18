import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { prisma, redis } from "@asm/db";
import { Client } from "@atproto/lex";
import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type {
  NodeSavedSession,
  NodeSavedState,
  RuntimeLock,
} from "@atproto/oauth-client-node";

import { blueskyOAuthMetadata } from "./oauth-config";

function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for Bluesky OAuth storage");
  }
  return createHash("sha256").update(`asm:bluesky:oauth:v1:${secret}`).digest();
}

function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url"
  );
}

function unseal<Value>(value: string): Value {
  const bytes = Buffer.from(value, "base64url");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    bytes.subarray(0, 12)
  );
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString()
  ) as Value;
}

function pendingKey(userId: string, did: string) {
  return `asm:bluesky:oauth:pending:${userId}:${did}`;
}

// oxlint-disable no-await-in-loop -- Lock acquisition must retry sequentially.
const requestLock: RuntimeLock = async (name, action) => {
  const key = `asm:bluesky:oauth:lock:${name}`;
  const owner = crypto.randomUUID();
  const deadline = Date.now() + 15_000;
  while ((await redis.set(key, owner, "PX", 60_000, "NX")) !== "OK") {
    if (Date.now() > deadline) {
      throw new Error("Bluesky session is busy");
    }
    await delay(50);
  }
  try {
    return await action();
  } finally {
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      key,
      owner
    );
  }
};

export function blueskyOAuthOrigin() {
  return new URL(
    process.env.BLUESKY_OAUTH_URL ??
      process.env.NEXT_PUBLIC_URL ??
      "http://127.0.0.1:3000"
  ).origin;
}

export function createBlueskyOAuthClient(userId: string, pending = false) {
  return new NodeOAuthClient({
    clientMetadata: blueskyOAuthMetadata(blueskyOAuthOrigin()),
    requestLock,
    sessionStore: {
      async del(did) {
        await redis.del(pendingKey(userId, did));
        if (!pending) {
          await prisma.orm.public.Accounts.where({
            accountId: did,
            providerId: "bluesky",
            userId,
          }).updateAndCount({ idToken: null });
        }
      },
      async get(did) {
        const account = await prisma.orm.public.Accounts.where({
          accountId: did,
          providerId: "bluesky",
          userId,
        }).first();
        const saved = pending
          ? await redis.get(pendingKey(userId, did))
          : account?.idToken;
        return saved ? unseal<NodeSavedSession>(saved) : undefined;
      },
      async set(did, data) {
        // The callback binds the session to an ASM user only after validating its browser state.
        if (pending) {
          await redis.set(pendingKey(userId, did), seal(data), "EX", 600);
          return;
        }
        await prisma.orm.public.Accounts.where({
          accountId: did,
          providerId: "bluesky",
          userId,
        })
          .where((account) => account.idToken.isNotNull())
          .updateAndCount({ idToken: seal(data) });
      },
    },
    stateStore: {
      async del(key) {
        await redis.del(`asm:bluesky:oauth:state:${key}`);
      },
      async get(key) {
        const saved = await redis.get(`asm:bluesky:oauth:state:${key}`);
        return saved ? unseal<NodeSavedState>(saved) : undefined;
      },
      async set(key, data) {
        await redis.set(
          `asm:bluesky:oauth:state:${key}`,
          seal(data),
          "EX",
          600
        );
      },
    },
  });
}

export async function finishBlueskyOAuth(
  userId: string,
  did: string,
  handle: string
) {
  const saved = await redis.get(pendingKey(userId, did));
  if (!saved) {
    throw new Error("Bluesky authorization expired");
  }
  await prisma.transaction(async (tx) => {
    const existing = await tx.orm.public.Accounts.where({
      accountId: did,
      providerId: "bluesky",
    }).first();
    if (existing && existing.userId !== userId) {
      throw new Error("This Bluesky account is already linked to another user");
    }
    const values = {
      accessToken: null,
      idToken: saved,
      issuer: handle,
      password: null,
      refreshToken: null,
      scope: blueskyOAuthMetadata(blueskyOAuthOrigin()).scope,
    };
    await (existing
      ? tx.orm.public.Accounts.where({ id: existing.id }).updateAndCount(values)
      : tx.orm.public.Accounts.create({
          ...values,
          accountId: did,
          providerId: "bluesky",
          userId,
        }));
  });
  await redis.del(pendingKey(userId, did));
}

export async function blueskyOAuthLexClient(userId: string, did: string) {
  const session = await createBlueskyOAuthClient(userId).restore(did);
  return new Client({
    did: session.did,
    fetchHandler: session.fetchHandler.bind(session),
  });
}
