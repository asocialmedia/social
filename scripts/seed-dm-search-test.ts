#!/usr/bin/env bun

import { hashPasswordWithScrypt } from "@asm/auth/core";
import { closePrisma, keys, prisma } from "@asm/db";
import {
  deriveMasterKey,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  KDF_ITERATIONS,
  publicKeyJwkToBase64,
  wrapRootKeyForMembers,
} from "@asm/messages/crypto";

const OWNER = {
  email: "dm-search-owner@asocialmedia.local",
  id: "11111111-1111-4111-8111-111111111101",
  username: "dmsearchowner",
  displayName: "DM Search Load Owner",
};
const PEER = {
  email: "dm-search-peer@asocialmedia.local",
  id: "11111111-1111-4111-8111-111111111102",
  username: "dmsearchpeer",
  displayName: "DM Search Load Peer",
};
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111103";
const TEST_PASSWORD = "Test@1234";

function requireLocalTestDatabase(): void {
  const url = new URL(keys.DATABASE_URL);
  const allowedHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const allowedDatabase = url.pathname.replace(/^\//, "") === "asocialmedia";
  if (
    process.env.NODE_ENV === "production" ||
    !allowedHost ||
    url.port !== "5433" ||
    !allowedDatabase
  ) {
    throw new Error(
      "Refusing to seed outside the local .env.test database on localhost:5433/asocialmedia"
    );
  }
}

async function prepareMember(member: typeof OWNER) {
  const pair = await generateIdentityKeyPair();
  const secretHash = await hashAccountSecret(generateAccountSecret());
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const masterKey = await deriveMasterKey(secretHash, salt, KDF_ITERATIONS);
  const backup = await encryptWithMasterKey(
    masterKey,
    JSON.stringify(await exportPrivateKeyJwk(pair.privateKey))
  );
  const identity = {
    encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    kdfIterations: KDF_ITERATIONS,
    masterKeyHash: secretHash,
    publicKey: publicKeyJwkToBase64(await exportPublicKeyJwk(pair.publicKey)),
    salt: Buffer.from(salt).toString("base64"),
    userId: member.id,
  };
  return {
    identity,
    member,
    password: await hashPasswordWithScrypt(TEST_PASSWORD),
    privateKey: pair.privateKey,
  };
}

function printFixture(): void {
  console.log(
    JSON.stringify(
      {
        conversationId: CONVERSATION_ID,
        messages: 200_000,
        owner: {
          email: OWNER.email,
          password: TEST_PASSWORD,
          username: OWNER.username,
        },
        peer: PEER.username,
        url: `/messages?c=${CONVERSATION_ID}`,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  requireLocalTestDatabase();
  const pairKey = [OWNER.id, PEER.id].toSorted().join(":");
  const existing = await prisma.orm.public.MessageConversations.select("id")
    .where({ id: CONVERSATION_ID, pairKey })
    .first();
  if (existing) {
    printFixture();
    return;
  }

  const collisions = await prisma.orm.public.Users.select("id", "username")
    .where((user) => user.username.in([OWNER.username, PEER.username]))
    .all();
  if (collisions.length > 0) {
    throw new Error(
      "DM search test usernames already exist; refusing to change existing accounts"
    );
  }
  if (!process.argv.includes("--apply")) {
    console.log(
      "Plan: create two local test accounts, a new DM, and recoverable message keys; pass --apply to write."
    );
    return;
  }

  const [owner, peer] = await Promise.all([
    prepareMember(OWNER),
    prepareMember(PEER),
  ]);
  const rootKey = generateRootKey();
  const fanout = await wrapRootKeyForMembers(
    owner.privateKey,
    [owner, peer].map((entry) => ({
      publicKeyBase64: entry.identity.publicKey,
      userId: entry.member.id,
    })),
    CONVERSATION_ID,
    rootKey
  );
  if (fanout.skipped.length > 0 || fanout.wrapped.length !== 2) {
    throw new Error("Could not create both recoverable DM key wraps");
  }

  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      [OWNER, PEER].map((member) => ({
        ...member,
        emailVerified: true,
      }))
    );
    await tx.orm.public.Accounts.createAll(
      [owner, peer].map((entry) => ({
        accountId: entry.member.id,
        password: entry.password,
        providerId: "credential",
        userId: entry.member.id,
      }))
    );
    await tx.orm.public.MessageIdentities.createAll([
      owner.identity,
      peer.identity,
    ]);
    await tx.orm.public.MessageConversations.create({
      id: CONVERSATION_ID,
      pairKey,
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [OWNER.id, PEER.id].map((userId) => ({
        conversationId: CONVERSATION_ID,
        userId,
      }))
    );
    await tx.orm.public.MessageConversationKeys.createAll(
      fanout.wrapped.map((wrap) => ({
        conversationId: CONVERSATION_ID,
        encryptedKey: wrap.encryptedKey.ciphertext,
        iv: wrap.encryptedKey.iv,
        ownerUserId: wrap.userId,
        ratchetCounter: 0,
        version: 1,
        wrapperPublicKey: owner.identity.publicKey,
        wrapperUserId: OWNER.id,
      }))
    );
    await tx.orm.public.Follows.create({
      followerId: OWNER.id,
      followingId: PEER.id,
    });
  });
  printFixture();
}

await main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrisma();
  });
