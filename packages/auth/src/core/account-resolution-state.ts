import {
  createAccountResolutionState,
  readAccountResolutionState,
  updateAccountResolutionState,
} from "@asm/db";
import { z } from "zod";

const proofSchema = z.object({
  at: z.number(),
  fingerprint: z.string(),
});

export const accountResolutionSchema = z.object({
  attempts: z.number().int().nonnegative().default(0),
  challenges: z
    .record(z.string(), z.object({ at: z.number(), cookie: z.string() }))
    .default({}),
  codes: z
    .record(
      z.string(),
      z.object({
        attempts: z.number(),
        digest: z.string(),
        email: z.string(),
        expiresAt: z.number(),
      })
    )
    .default({}),
  email: z.string().optional(),
  identityVerified: z.boolean().default(false),
  kind: z.enum(["oauth", "email"]),
  otherUserId: z.string().nullable(),
  proofs: z.record(z.string(), proofSchema).default({}),
  provider: z.enum(["google", "reddit"]).optional(),
  providerAccountId: z.string().optional(),
  providerOwnerId: z.string().nullable().optional(),
  sessionId: z.string(),
  setupEmails: z.record(z.string(), z.string()).default({}),
  userId: z.string(),
  version: z.literal(1),
});

export type AccountResolutionState = z.infer<typeof accountResolutionSchema>;

export interface AccountResolutionStore {
  create: (id: string, state: AccountResolutionState) => Promise<void> | void;
  read: (
    id: string
  ) =>
    | Promise<{ state: AccountResolutionState; serialized: string } | null>
    | { state: AccountResolutionState; serialized: string }
    | null;
  update: (
    id: string,
    previous: string,
    state: AccountResolutionState
  ) => Promise<boolean> | boolean;
}

export const accountResolutionStore: AccountResolutionStore = {
  async create(id, state) {
    await createAccountResolutionState(
      id,
      state.userId,
      JSON.stringify(state),
      new Date(Date.now() + 30 * 60_000)
    );
  },
  async read(id) {
    const serialized = await readAccountResolutionState(id);
    if (!serialized) {
      return null;
    }
    const parsed = accountResolutionSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? { serialized, state: parsed.data } : null;
  },
  update(id, previous, state) {
    return updateAccountResolutionState(id, previous, JSON.stringify(state));
  },
};

export function newAccountResolutionState(
  userId: string,
  sessionId: string,
  source:
    | { kind: "oauth"; provider: "google" | "reddit" }
    | { kind: "email"; email: string; otherUserId: string }
): AccountResolutionState {
  return accountResolutionSchema.parse({
    otherUserId: null,
    sessionId,
    userId,
    version: 1,
    ...source,
  });
}
