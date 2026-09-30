#!/usr/bin/env bun

// Marks the message-feature test accounts as email-verified.
//
// Signup sends a verification OTP through the real email service, which in this
// environment logs instead of delivering, so there is no way to complete the flow
// through the UI. Verification is a boolean on the user row, so setting it
// directly produces exactly the state a verified account has and lets the device
// sign in normally.
//
// This touches ONLY the accounts created by create-message-test-users.ts. It is a
// development script and refuses to run without an explicit username, so it cannot
// be pointed at a real account by accident.
//
// Usage: bun apps/auth/scripts/verify-message-test-users.ts msgtestalice [msgtestbob ...]

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "dotenv";

const AUTH_ENV = path.resolve(import.meta.dir, "../.env.development");

const usernames = process.argv.slice(2);
if (usernames.length === 0) {
  throw new Error(
    "Pass the usernames to verify, e.g. `bun run ... msgtestalice msgtestbob`"
  );
}

for (const file of [
  AUTH_ENV,
  path.resolve(import.meta.dir, "../../../apps/web/.env.local"),
  path.resolve(import.meta.dir, "../../../.env"),
]) {
  try {
    Object.assign(process.env, parse(readFileSync(file, "utf-8")));
  } catch {
    // Optional.
  }
}

const { prisma, closePrisma } = await import("@asm/db");

try {
  for (const username of usernames) {
    // oxlint-disable-next-line no-await-in-loop -- one row at a time, and each update reports its own outcome in order
    const row = await prisma.orm.public.Users.where({ username }).first();
    if (!row) {
      console.log(`${username}: not found`);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    await prisma.orm.public.Users.where({ id: row.id }).update({
      emailVerified: true,
    });
    console.log(`${username}: verified (${row.id})`);
  }
} finally {
  await closePrisma();
}
