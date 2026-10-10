#!/usr/bin/env bun

// Creates a signed-in pair of test accounts for exercising the messages feature
// end to end on a device.
//
// WHY NOT THE HTTP SIGNUP: /api/auth/sign-up/email is gated behind an internal
// secret AND a Turnstile token, and the Turnstile token can only be produced by the
// real widget in a WebView. This calls better-auth's API in-process instead, which
// skips the HTTP layer without skipping the account creation: the rows, the
// password hash and the session are exactly what a browser signup produces.
//
// Usage: bun apps/auth/scripts/create-message-test-users.ts [prefix]
//
// The password is a local throwaway, printed on success so it can be typed into the
// app. Override with ASM_TEST_USER_PASSWORD; the default exists only so the script
// is runnable with no setup, and it must never point at a real database.

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "dotenv";

const AUTH_ENV = path.resolve(import.meta.dir, "../.env.development");

async function main() {
  const prefix = process.argv[2] ?? "msgtest";
  if (
    process.env.DATABASE_URL &&
    !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
  ) {
    throw new Error(
      "Refusing to run against a non-local DATABASE_URL. These are throwaway accounts."
    );
  }
  const password = process.env.ASM_TEST_USER_PASSWORD ?? "asm-local-test-only";

  for (const file of [
    AUTH_ENV,
    path.resolve(import.meta.dir, "../../../apps/web/.env.local"),
    path.resolve(import.meta.dir, "../../../.env"),
  ]) {
    try {
      Object.assign(process.env, parse(readFileSync(file, "utf-8")));
    } catch {
      // A missing optional env file is fine; the required ones are asserted below.
    }
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (apps/auth/.env.development)");
  }

  // The auth config builds the better-auth instance; importing it in-process
  // skips the HTTP layer (and therefore the CAPTCHA gate) without skipping account
  // creation.
  // Relative, because the auth config is not exported from the package's public
  // entry point. This script therefore has to live inside apps/auth: the repo-root
  // scripts/tsconfig.json has no `jsx` option, so pulling this file in from there
  // would fail to resolve the email templates it renders.
  const { auth } = await import("../src/auth/config");
  const { prisma, closePrisma } = await import("@asm/db");

  try {
    for (const name of [`${prefix}alice`, `${prefix}bob`]) {
      // The signup hook runs an advanced email validation, which rejects
      // special-use TLDs like .test even with MX/SMTP checks skipped. A real
      // domain is required to get past it.
      const email = `${name}@gmail.com`;
      // oxlint-disable-next-line no-await-in-loop -- one account at a time: better-auth's signup is rate limited per client IP, so running both in parallel would trip it
      const existing = await prisma.orm.public.Users.where({ email }).first();
      if (existing) {
        console.log(`${name}: already exists (${existing.id})`);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- see above
      const created = await auth.api.signUpEmail({
        body: { email, name, password, username: name },
        headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
      });
      const id = (created as { user?: { id?: string } })?.user?.id;
      console.log(`${name}: created (${id})`);
    }
  } finally {
    await closePrisma();
  }
}

await main();
