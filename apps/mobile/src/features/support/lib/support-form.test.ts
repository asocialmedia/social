import { describe, expect, test } from "bun:test";

import {
  SUPPORT_MAX_ATTACHMENTS,
  SUPPORT_MAX_FILE_BYTES,
  SupportSubmitError,
  buildSupportPayload,
  canContinueFromSupportStepOne,
  canContinueFromSupportStepTwo,
  isSupportAttachmentAllowed,
  isSupportEmailValid,
  submitSupportTicket,
  supportAttachmentProblem,
  uploadSupportAttachment,
} from "./support-form";
import type { SupportFormFields } from "./support-form";

const FIELDS: SupportFormFields = {
  browser: "Expo app",
  category: "technical",
  email: "user@example.com",
  message: "The feed flickers on scroll.",
  os: "android",
  priority: "medium",
  subject: "Feed flicker",
  type: "bug",
};

describe("support form validation", () => {
  test("gates step one on a valid email and a type", () => {
    expect(canContinueFromSupportStepOne(FIELDS)).toBe(true);
    expect(
      canContinueFromSupportStepOne({ ...FIELDS, email: "not-an-email" })
    ).toBe(false);
    expect(canContinueFromSupportStepOne({ ...FIELDS, type: "" })).toBe(false);
    expect(isSupportEmailValid("user@example.com")).toBe(true);
    expect(isSupportEmailValid("user@")).toBe(false);
  });

  test("gates step two on a category and a subject", () => {
    expect(canContinueFromSupportStepTwo(FIELDS)).toBe(true);
    expect(canContinueFromSupportStepTwo({ ...FIELDS, category: "" })).toBe(
      false
    );
    expect(canContinueFromSupportStepTwo({ ...FIELDS, subject: "  " })).toBe(
      false
    );
  });

  test("caps attachments at three like web", () => {
    expect(isSupportAttachmentAllowed(0, 3)).toBe(true);
    expect(isSupportAttachmentAllowed(2, 2)).toBe(false);
    expect(SUPPORT_MAX_ATTACHMENTS).toBe(3);
  });

  test("rejects wrong types and oversized files like web", () => {
    expect(supportAttachmentProblem("video/mp4", 100)).toBe(
      "Images, PDFs, or text files only, please"
    );
    expect(supportAttachmentProblem(undefined, 100)).toBe(
      "Images, PDFs, or text files only, please"
    );
    expect(
      supportAttachmentProblem("image/png", SUPPORT_MAX_FILE_BYTES + 1)
    ).toBe("Keep files under 5MB");
    expect(supportAttachmentProblem("image/png", 100)).toBeNull();
  });

  test("builds the web ticket payload shape", () => {
    const attachments = [
      { key: "k1", name: "shot.png", type: "image/png", url: "https://u" },
    ];
    expect(buildSupportPayload(FIELDS, attachments)).toEqual({
      ...FIELDS,
      attachments,
    });
  });
});

describe("support ticket submit", () => {
  test("posts the ticket JSON to the web endpoint", async () => {
    let seen: { body?: unknown; url?: string } = {};
    const baseFetch = ((url: string, init?: RequestInit) => {
      seen = { body: init?.body, url };
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch;
    await submitSupportTicket(FIELDS, [], {
      apiBase: "https://asocialmedia.cc",
      baseFetch,
    });
    expect(seen.url).toBe("https://asocialmedia.cc/api/support");
    const sent = JSON.parse(seen.body as string) as Record<string, unknown>;
    expect(sent["subject"]).toBe("Feed flicker");
    expect(sent["attachments"]).toEqual([]);
  });

  test("throws the server message on failure", async () => {
    const baseFetch = ((url: string, _init?: RequestInit) => {
      void url;
      void _init;
      return Promise.resolve(
        Response.json({ error: "Slow down" }, { status: 429 })
      );
    }) as typeof fetch;
    await expect(
      submitSupportTicket(FIELDS, [], {
        apiBase: "https://asocialmedia.cc",
        baseFetch,
      })
    ).rejects.toBeInstanceOf(SupportSubmitError);
  });

  test("uploads with the web multipart fields", async () => {
    let seenFields: string[] = [];
    const baseFetch = ((url: string, init?: RequestInit) => {
      void url;
      if (!init?.body) {
        return Promise.resolve(
          Response.json({ error: "empty" }, { status: 400 })
        );
      }
      seenFields = [...((init.body as FormData).keys() as Iterable<string>)];
      return Promise.resolve(Response.json({ key: "k", url: "https://u" }));
    }) as typeof fetch;
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const uploaded = await uploadSupportAttachment(
      file,
      "shot.png",
      "image/png",
      {
        apiBase: "https://asocialmedia.cc",
        baseFetch,
      }
    );
    expect(uploaded).toEqual({
      key: "k",
      name: "shot.png",
      type: "image/png",
      url: "https://u",
    });
    expect(seenFields).toEqual(["file", "fileName", "fileType"]);
  });
});
