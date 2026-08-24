import { describe, expect, test } from "bun:test";

import {
  allowedTransitions,
  assertTransition,
  canTransition,
  CLAIMABLE_STATUSES,
  InvalidTransitionError,
  isTerminalStatus,
} from "./state-machine";

describe("media state machine", () => {
  test("happy path is fully connected", () => {
    const path = [
      "UPLOADING",
      "QUARANTINED",
      "SCANNING",
      "PROCESSING",
      "READY",
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  test("uploading can never skip straight to ready", () => {
    expect(canTransition("UPLOADING", "READY")).toBe(false);
    expect(canTransition("UPLOADING", "PROCESSING")).toBe(false);
  });

  test("scanning rejects or fails but never publishes directly", () => {
    expect(canTransition("SCANNING", "REJECTED")).toBe(true);
    expect(canTransition("SCANNING", "FAILED")).toBe(true);
    expect(canTransition("SCANNING", "READY")).toBe(false);
  });

  test("ready supports reprocessing and deletion only", () => {
    expect(allowedTransitions("READY")).toEqual(["PROCESSING", "DELETED"]);
  });

  test("rejected rows are terminal except deletion", () => {
    expect(isTerminalStatus("REJECTED")).toBe(true);
    expect(canTransition("REJECTED", "PROCESSING")).toBe(false);
    expect(canTransition("REJECTED", "SCANNING")).toBe(false);
  });

  test("deleted is fully terminal", () => {
    expect(isTerminalStatus("DELETED")).toBe(true);
    expect(allowedTransitions("DELETED")).toEqual([]);
  });

  test("failed rows may be retried back through quarantine or processing", () => {
    expect(canTransition("FAILED", "QUARANTINED")).toBe(true);
    expect(canTransition("FAILED", "PROCESSING")).toBe(true);
  });

  test("assertTransition throws a typed error on invalid jumps", () => {
    expect(() => assertTransition("UPLOADING", "READY")).toThrow(
      InvalidTransitionError
    );
    expect(() => assertTransition("QUARANTINED", "QUARANTINED")).toThrow(
      InvalidTransitionError
    );
    expect(() => assertTransition("SCANNING", "PROCESSING")).not.toThrow();
  });

  test("rejected and deleted media are never claimable for posts", () => {
    expect(CLAIMABLE_STATUSES).not.toContain("REJECTED");
    expect(CLAIMABLE_STATUSES).not.toContain("DELETED");
    expect(CLAIMABLE_STATUSES).not.toContain("FAILED");
  });
});
