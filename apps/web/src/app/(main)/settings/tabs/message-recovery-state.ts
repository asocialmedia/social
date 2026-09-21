// State mapping for the messages recovery settings card, split out from the
// component so the branch table is unit-tested without a DOM. Kept free of
// React and the crypto helpers, which is why it takes the fact as input rather
// than reading it itself.
//
// "enabled" is defined purely by the server identity row: the backup key derives
// from that row, so its existence is exactly the recoverable state.

export type RecoveryState = "loading" | "not-set-up" | "enabled";

export function resolveRecoveryState(input: {
  identityExists: boolean;
}): Exclude<RecoveryState, "loading"> {
  return input.identityExists ? "enabled" : "not-set-up";
}
