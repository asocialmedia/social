import { afterAll, expect, test } from "bun:test";

import prisma, { closePrisma } from "./prisma";
import { searchUsers } from "./search";

const suffix = crypto.randomUUID();
const ids: string[] = [];
afterAll(async () => {
  if (ids.length) {
    await prisma.orm.public.Users.where((user) =>
      user.id.in(ids)
    ).deleteAndCount();
  }
  await closePrisma();
});

test("short account searches match handles and display-name words, never incidental UUID substrings", async () => {
  for (const [username, displayName] of [
    [`fixture-${suffix}-af1b`, "Unrelated fixture"],
    [`f1-${suffix}`, "Racing team"],
    [`racing-${suffix}`, "Scuderia F1"],
    [`banned-${suffix}`, "F1 banned fixture"],
  ]) {
    const id = crypto.randomUUID();
    ids.push(id);
    // oxlint-disable-next-line no-await-in-loop -- fixture order defines the asserted identities.
    await prisma.orm.public.Users.create({
      banned: username.startsWith("banned-"),
      displayName,
      id,
      username,
    });
  }
  const matches = await searchUsers("f1", 20);
  const found = new Set(matches.map((user) => user.id));
  expect(found.has(ids[0])).toBe(false);
  expect(found.has(ids[1])).toBe(true);
  expect(found.has(ids[2])).toBe(true);
  expect(found.has(ids[3])).toBe(false);
});
