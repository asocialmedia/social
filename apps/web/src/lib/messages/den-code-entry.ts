import { DEN_SHORT_CODE_LENGTH } from "@asm/db/messages/dens";

import { MessagesApiError } from "./client";
import type { DenInvitePreviewResponse } from "./client";
import { DEN_BAN_JOIN_DESCRIPTION } from "./den-ban-copy";
import { denJoinOutcome } from "./den-invite";
import type { DenJoinOutcome } from "./den-invite";

export type DenCodeEntryAccepted = Extract<
  DenJoinOutcome,
  { kind: "joinable" | "already-member" }
>;

export interface DenCodeEntryError {
  invalid: boolean;
  message: string;
  retryable: boolean;
  needsMessages?: boolean;
}

export type DenCodeEntryState =
  | { code: string; status: "editing" | "checking" }
  | { code: string; status: "error"; error: DenCodeEntryError }
  | { code: string; status: "accepted"; outcome: DenCodeEntryAccepted };

export function normalizeDenEntryCode(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, "")
    .slice(0, DEN_SHORT_CODE_LENGTH);
}

const UNKNOWN_CODE: DenCodeEntryError = {
  invalid: true,
  message: "This code doesn't match a den. Check it and try again.",
  retryable: false,
};

export function denCodeEntryFailure(error: unknown): DenCodeEntryError {
  if (error instanceof MessagesApiError) {
    if (error.status === 404) {
      return UNKNOWN_CODE;
    }
    if (error.status === 429) {
      return {
        invalid: false,
        message: "Too many attempts just now. Wait a moment, then try again.",
        retryable: true,
      };
    }
    if (error.status === 409) {
      return {
        invalid: false,
        message: "Turn on Messages before joining this den.",
        needsMessages: true,
        retryable: false,
      };
    }
    if (error.status === 403 && error.code === "BANNED") {
      return {
        invalid: false,
        message: DEN_BAN_JOIN_DESCRIPTION,
        retryable: false,
      };
    }
  }
  return {
    invalid: false,
    message: "Couldn't check this code. Check your connection and try again.",
    retryable: true,
  };
}

export function createDenCodeEntryController({
  lookup,
  onStateChange,
}: {
  lookup: (code: string) => Promise<DenInvitePreviewResponse>;
  onStateChange: (state: DenCodeEntryState) => void;
}) {
  let state: DenCodeEntryState = { code: "", status: "editing" };
  let revision = 0;
  let active = true;

  const publish = (next: DenCodeEntryState) => {
    state = next;
    onStateChange(next);
  };

  const check = async () => {
    if (
      !active ||
      state.code.length !== DEN_SHORT_CODE_LENGTH ||
      state.status === "checking" ||
      state.status === "accepted" ||
      (state.status === "error" && !state.error.retryable)
    ) {
      return;
    }
    const { code } = state;
    revision += 1;
    const requestRevision = revision;
    publish({ code, status: "checking" });
    try {
      const preview = await lookup(code);
      if (!active || requestRevision !== revision) {
        return;
      }
      const outcome = denJoinOutcome({ preview });
      if (outcome.kind === "joinable" || outcome.kind === "already-member") {
        publish({ code, outcome, status: "accepted" });
        return;
      }
      let error = UNKNOWN_CODE;
      if (outcome.kind === "expired") {
        error = {
          invalid: true,
          message:
            "This code has expired or been replaced. Ask for a new invite code.",
          retryable: false,
        };
      } else if (outcome.kind === "banned") {
        error = {
          invalid: false,
          message: DEN_BAN_JOIN_DESCRIPTION,
          retryable: false,
        };
      } else if (outcome.kind === "full") {
        error = {
          invalid: false,
          message: "This den is full. Ask whoever invited you to make room.",
          retryable: true,
        };
      }
      publish({ code, error, status: "error" });
    } catch (error) {
      if (active && requestRevision === revision) {
        publish({ code, error: denCodeEntryFailure(error), status: "error" });
      }
    }
  };

  return {
    async change(value: string) {
      const code = normalizeDenEntryCode(value);
      if (!active || code === state.code) {
        return;
      }
      revision += 1;
      publish({ code, status: "editing" });
      await check();
    },
    check,
    deactivate() {
      active = false;
      revision += 1;
    },
    reject(error: unknown) {
      if (!active) {
        return;
      }
      revision += 1;
      publish({
        code: state.code,
        error: denCodeEntryFailure(error),
        status: "error",
      });
    },
  };
}
