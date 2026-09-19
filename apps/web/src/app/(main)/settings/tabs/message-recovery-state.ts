// State mapping for the messages recovery settings card, split out from the
// component so the branch table is unit-tested without a DOM. Kept free of
// React and the crypto helpers, which is why it takes the two facts as input
// rather than reading them itself.
//
// "set up" is defined by the server identity row, not the local secret: a
// leftover secret with no identity cannot decrypt anything, so it is not a
// recoverable state.

export type RecoveryState = "loading" | "not-set-up" | "recoverable" | "locked";

export function resolveRecoveryState(input: {
  deviceSecret: string | null;
  identityExists: boolean;
}): Exclude<RecoveryState, "loading"> {
  if (!input.identityExists) {
    return "not-set-up";
  }
  return input.deviceSecret ? "recoverable" : "locked";
}
