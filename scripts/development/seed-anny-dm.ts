import { closePrisma, keys, prisma } from "@asm/db";
import {
  decryptWithMasterKey,
  deriveMasterKey,
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
} from "@asm/messages/crypto";

const DEMO = {
  displayName: "anny",
  email: "anny-dm-demo@asocialmedia.local",
  id: "local-dm-anny-demo",
  username: "anny_demo",
};
const CONVERSATION_ID = crypto.randomUUID();

function requireLocalDatabase() {
  const url = new URL(keys.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.port !== "5433" ||
    url.pathname !== "/asocialmedia"
  ) {
    throw new Error(
      "This fixture only supports the local test database on localhost:5433/asocialmedia"
    );
  }
}

async function createDemoIdentity() {
  const peerKeys = await generateIdentityKeyPair();
  const hash = await hashAccountSecret(generateAccountSecret());
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const peerMasterKey = await deriveMasterKey(hash, salt, KDF_ITERATIONS);
  const backup = await encryptWithMasterKey(
    peerMasterKey,
    JSON.stringify(await exportPrivateKeyJwk(peerKeys.privateKey))
  );
  return {
    encryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    kdfIterations: KDF_ITERATIONS,
    masterKeyHash: hash,
    publicKey: publicKeyJwkToBase64(
      await exportPublicKeyJwk(peerKeys.publicKey)
    ),
    salt: Buffer.from(salt).toString("base64"),
    userId: DEMO.id,
  };
}

async function main() {
  requireLocalDatabase();
  const owner = await prisma.orm.public.Users.where({
    username: "anny",
  }).first();
  if (!owner)
    throw new Error("Open the app as @anny before creating this fixture");
  const identity = await prisma.orm.public.MessageIdentities.where({
    userId: owner.id,
  }).first();
  if (!identity?.masterKeyHash)
    throw new Error("Enable messages as @anny first");
  const existingPeer = await prisma.orm.public.Users.where({
    id: DEMO.id,
  }).first();
  if (
    existingPeer &&
    (existingPeer.username !== DEMO.username ||
      existingPeer.email !== DEMO.email)
  ) {
    throw new Error("The fixture user ID is already used by another account");
  }
  const pairKey = [owner.id, DEMO.id].toSorted().join(":");
  const existingConversation =
    await prisma.orm.public.MessageConversations.where({ pairKey }).first();
  if (existingConversation) {
    console.log(
      JSON.stringify({
        conversationId: existingConversation.id,
        created: false,
        peer: DEMO.username,
        url: `/messages?c=${existingConversation.id}`,
      })
    );
    return;
  }
  if (
    await prisma.orm.public.MessageConversations.where({
      id: CONVERSATION_ID,
    }).first()
  ) {
    throw new Error(
      "The fixture conversation ID is already used by another DM"
    );
  }
  const masterKey = await deriveMasterKey(
    identity.masterKeyHash,
    Uint8Array.from(Buffer.from(identity.salt, "base64")),
    identity.kdfIterations
  );
  const [iv, ciphertext] = identity.encryptedPrivateKey.split(".");
  if (!iv || !ciphertext)
    throw new Error("The current identity backup is unreadable");
  const privateJwk: JsonWebKey = JSON.parse(
    await decryptWithMasterKey(masterKey, { ciphertext, iv })
  );
  const ownerPrivateKey = await importPrivateKeyJwk(privateJwk);
  const existingIdentity = await prisma.orm.public.MessageIdentities.where({
    userId: DEMO.id,
  }).first();
  const peerIdentity = existingIdentity ?? (await createDemoIdentity());
  const rootKey = generateRootKey();
  const recipients = [
    { publicKeyBase64: identity.publicKey, userId: owner.id },
    { publicKeyBase64: peerIdentity.publicKey, userId: DEMO.id },
  ];
  const fanout = await wrapRootKeyForMembers(
    ownerPrivateKey,
    recipients,
    CONVERSATION_ID,
    rootKey
  );
  if (fanout.skipped.length || fanout.wrapped.length !== 2)
    throw new Error("Both members need readable key wraps");
  const ownerWrap = fanout.wrapped.find((entry) => entry.userId === owner.id);
  if (!ownerWrap) throw new Error("Missing owner wrap");
  const roundTrip = await unwrapRootKey(
    ownerPrivateKey,
    await importPublicKeyJwk(publicKeyBase64ToJwk(identity.publicKey)),
    CONVERSATION_ID,
    ownerWrap.encryptedKey
  );
  if (!Buffer.from(rootKey).equals(Buffer.from(roundTrip)))
    throw new Error("Conversation key verification failed");
  await prisma.transaction(async (tx) => {
    if (!existingPeer)
      await tx.orm.public.Users.create({ ...DEMO, emailVerified: true });
    if (!existingIdentity)
      await tx.orm.public.MessageIdentities.create(peerIdentity);
    await tx.orm.public.MessageConversations.create({
      id: CONVERSATION_ID,
      pairKey,
    });
    await tx.orm.public.MessageConversationMembers.createAll(
      [owner.id, DEMO.id].map((userId) => ({
        conversationId: CONVERSATION_ID,
        unreadCount: 0,
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
        wrapperPublicKey: identity.publicKey,
        wrapperUserId: owner.id,
      }))
    );
    const follow = await tx.orm.public.Follows.where({
      followerId: owner.id,
      followingId: DEMO.id,
    }).first();
    if (!follow)
      await tx.orm.public.Follows.create({
        followerId: owner.id,
        followingId: DEMO.id,
      });
  });
  console.log(
    JSON.stringify({
      conversationId: CONVERSATION_ID,
      created: true,
      members: 2,
      peer: DEMO.username,
      url: `/messages?c=${CONVERSATION_ID}`,
    })
  );
}

await main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Fixture creation failed"
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrisma();
  });
