import { expect, test } from "bun:test";

import { SignJWT } from "jose";

import {
  signNetworkObservation,
  verifyNetworkObservation,
} from "./network-observation";

const receipt = {
  authorId: "remote-author",
  hasImage: true,
  hasVideo: false,
  postId: "https://future.example/posts/one",
  profileId: "default",
  publicContent: true,
  revision: 2,
  source: "activitypub",
  topics: ["astronomy"],
};

test("signed observations bind source metadata to the correct viewer and reject tampering", async () => {
  const token = await signNetworkObservation("reader-a", receipt);
  expect(await verifyNetworkObservation("reader-a", token)).toEqual(receipt);
  await expect(verifyNetworkObservation("reader-b", token)).rejects.toThrow();
  const [header, , signature] = token.split(".");
  const forged = `${header}.${Buffer.from(JSON.stringify({ ...receipt, topics: ["forged"] })).toString("base64url")}.${signature}`;
  await expect(verifyNetworkObservation("reader-a", forged)).rejects.toThrow();
});

test("expired observations cannot revive old interest or safety settings", async () => {
  const token = await new SignJWT(receipt)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("asm:network-observation")
    .setAudience("reader-a")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 1200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
    .sign(new TextEncoder().encode(process.env.BETTER_AUTH_SECRET));
  await expect(verifyNetworkObservation("reader-a", token)).rejects.toThrow();
});
