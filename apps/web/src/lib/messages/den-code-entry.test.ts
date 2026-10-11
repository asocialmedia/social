import { describe, expect, mock, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import { MessagesApiError } from "./client";
import type { DenInvitePreviewResponse } from "./client";
import {
  createDenCodeEntryController,
  normalizeDenEntryCode,
} from "./den-code-entry";
import type { DenCodeEntryState } from "./den-code-entry";

function preview(
  overrides: Partial<
    Extract<DenInvitePreviewResponse, { expired?: undefined }>
  > = {}
): DenInvitePreviewResponse {
  return {
    den: {
      avatarMediaId: null,
      id: "den-1",
      memberCount: 3,
      name: "Night owls",
    },
    isMember: false,
    ...overrides,
  };
}

function setup(lookup = mock((_code: string) => preview())) {
  const states: DenCodeEntryState[] = [];
  const controller = createDenCodeEntryController({
    lookup,
    onStateChange: (state) => {
      states.push(state);
    },
  });
  return { controller, lookup, states };
}

describe("den code entry", () => {
  test("normalizes typed and pasted codes before limiting their length", () => {
    expect(normalizeDenEntryCode(" ab-c 123\n")).toBe("ABC123");
    expect(normalizeDenEntryCode("abc123extra")).toBe("ABC123");
  });

  test("does not check partial codes", async () => {
    const { controller, lookup, states } = setup();
    await controller.change("abc12");
    await controller.check();
    expect(lookup).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ code: "ABC12", status: "editing" });
  });

  test("automatically checks the sixth character and accepts its den", async () => {
    const { controller, lookup, states } = setup();
    await controller.change("abc12");
    await controller.change("abc123");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("ABC123");
    expect(states.at(-2)).toEqual({ code: "ABC123", status: "checking" });
    expect(states.at(-1)).toMatchObject({
      code: "ABC123",
      outcome: { den: { id: "den-1" }, kind: "joinable" },
      status: "accepted",
    });
  });

  test("pasting a complete code checks it automatically", async () => {
    const { controller, lookup } = setup();
    await controller.change("ab-c 123");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("ABC123");
  });

  test("a repeated completion or submit does not duplicate an in-flight check", async () => {
    const pending = Promise.withResolvers<DenInvitePreviewResponse>();
    const { controller, lookup } = setup(mock(() => pending.promise));
    const checking = controller.change("ABC123");
    await controller.change("ABC123");
    await controller.check();
    expect(lookup).toHaveBeenCalledTimes(1);
    pending.resolve(preview());
    await checking;
    await controller.check();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("an unknown code stays invalid until the next edit", async () => {
    const { controller, lookup, states } = setup(
      mock(() => {
        throw new MessagesApiError("Not found", 404);
      })
    );
    await controller.change("BAD123");
    expect(states.at(-1)).toMatchObject({
      code: "BAD123",
      error: {
        invalid: true,
        message: "This code doesn't match a den. Check it and try again.",
        retryable: false,
      },
      status: "error",
    });
    await controller.check();
    await controller.change("bad123");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.status).toBe("error");
    await controller.change("BAD12");
    expect(states.at(-1)).toEqual({ code: "BAD12", status: "editing" });
  });

  test("editing a complete code checks the corrected code without Continue", async () => {
    const lookup = mock((code: string) => {
      if (code === "BAD123") {
        throw new MessagesApiError("Not found", 404);
      }
      return preview();
    });
    const { controller, states } = setup(lookup);
    await controller.change("BAD123");
    await controller.change("ABC123");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.status).toBe("accepted");
  });

  test("a late success cannot accept a code that has been edited", async () => {
    const pending = Promise.withResolvers<DenInvitePreviewResponse>();
    const { controller, states } = setup(mock(() => pending.promise));
    const checking = controller.change("ABC123");
    await controller.change("ABC12");
    pending.resolve(preview());
    await checking;
    expect(states.at(-1)).toEqual({ code: "ABC12", status: "editing" });
  });

  test("a late rejection cannot replace a newer accepted code", async () => {
    const pending = Promise.withResolvers<DenInvitePreviewResponse>();
    const { controller, states } = setup(
      mock(async (code: string) =>
        code === "OLD123" ? await pending.promise : preview()
      )
    );
    const oldCheck = controller.change("OLD123");
    await controller.change("NEW123");
    pending.reject(new MessagesApiError("Not found", 404));
    await oldCheck;
    expect(states.at(-1)).toMatchObject({ code: "NEW123", status: "accepted" });
  });

  test("closing invalidates a pending response", async () => {
    const pending = Promise.withResolvers<DenInvitePreviewResponse>();
    const { controller, states } = setup(mock(() => pending.promise));
    const checking = controller.change("ABC123");
    controller.deactivate();
    const notifications = states.length;
    pending.resolve(preview());
    await checking;
    expect(states).toHaveLength(notifications);
  });

  test("an expired code stays in code entry with actionable copy", async () => {
    const { controller, states } = setup(
      mock(() => ({
        den: {
          id: "den-1",
          memberCount: 3,
          name: "Night owls",
          ownerId: "owner-1",
        },
        expired: true,
        isMember: false,
      }))
    );
    await controller.change("ABC123");
    expect(states.at(-1)).toMatchObject({
      error: {
        invalid: true,
        message:
          "This code has expired or been replaced. Ask for a new invite code.",
        retryable: false,
      },
      status: "error",
    });
  });

  test("an existing member can open their den with a retired code", async () => {
    const { controller, states } = setup(
      mock(() => ({
        den: {
          id: "den-1",
          memberCount: 3,
          name: "Night owls",
          ownerId: "owner-1",
        },
        expired: true,
        isMember: true,
      }))
    );
    await controller.change("ABC123");
    expect(states.at(-1)).toMatchObject({
      outcome: { kind: "already-member" },
      status: "accepted",
    });
  });

  test("a full den explains capacity without calling its code invalid", async () => {
    const { controller, states } = setup(
      mock(() =>
        preview({
          den: {
            avatarMediaId: null,
            id: "den-1",
            memberCount: DEN_LIMITS.membersMax,
            name: "Night owls",
          },
        })
      )
    );
    await controller.change("ABC123");
    expect(states.at(-1)).toMatchObject({
      error: {
        invalid: false,
        message: "This den is full. Ask whoever invited you to make room.",
        retryable: true,
      },
      status: "error",
    });
  });

  test("a ban never reaches the join confirmation", async () => {
    const { controller, states } = setup(
      mock(() => preview({ isBanned: true }))
    );
    await controller.change("ABC123");
    expect(states.at(-1)).toMatchObject({
      error: { invalid: false, retryable: false },
      status: "error",
    });
  });

  test.each([429, 500])(
    "a %s failure is retryable without blaming the code",
    async (status) => {
      const lookup = mock(() => {
        throw new MessagesApiError("Unavailable", status);
      });
      const { controller, states } = setup(lookup);
      await controller.change("ABC123");
      expect(states.at(-1)).toMatchObject({
        error: { invalid: false, retryable: true },
        status: "error",
      });
      await controller.check();
      expect(lookup).toHaveBeenCalledTimes(2);
    }
  );

  test("a network failure can be retried successfully with the same code", async () => {
    const lookup = mock(() => preview());
    lookup.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { controller, states } = setup(lookup);
    await controller.change("ABC123");
    expect(states.at(-1)).toMatchObject({
      error: { invalid: false, retryable: true },
      status: "error",
    });
    await controller.check();
    expect(states.at(-1)?.status).toBe("accepted");
  });

  test("Messages setup failures offer setup instead of retrying forever", async () => {
    const { controller, states } = setup(
      mock(() => {
        throw new MessagesApiError("Identity required", 409);
      })
    );
    await controller.change("ABC123");
    expect(states.at(-1)).toMatchObject({
      error: { invalid: false, needsMessages: true, retryable: false },
      status: "error",
    });
  });

  test("a code retired after preview returns to editable code entry", async () => {
    const { controller, states } = setup();
    await controller.change("ABC123");
    controller.reject(new MessagesApiError("Not found", 404));
    expect(states.at(-1)).toMatchObject({
      code: "ABC123",
      error: { invalid: true },
      status: "error",
    });
  });
});
