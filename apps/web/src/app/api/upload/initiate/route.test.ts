import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { POST } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockFindMember = mock((conversationId: string) =>
  conversationId === "convo-1"
    ? { conversationId: "convo-1", userId: "user1" }
    : null
);
const mockCreateUpload = mock(
  (input: Record<string, unknown>): Promise<Record<string, unknown>> =>
    Promise.resolve({
      extension: "png",
      input,
      mediaId: "media-1",
      status: "UPLOADING",
      uploadUrl: "https://storage.example/upload",
    })
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  prisma: {
    orm: {
      public: {
        MessageConversationMembers: {
          select: () => ({
            where: (
              predicate: (member: {
                conversationId: { eq: (id: string) => unknown };
                userId: { eq: (id: string) => unknown };
              }) => unknown
            ) => {
              let conversationId = "";
              predicate({
                conversationId: {
                  eq: (id) => {
                    conversationId = id;
                    return {};
                  },
                },
                userId: { eq: () => ({}) },
              });
              return { first: () => mockFindMember(conversationId) };
            },
          }),
        },
      },
    },
  },
}));

mock.module("@/lib/media/media-pipeline", () => ({
  UploadPolicyError: class UploadPolicyError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "UploadPolicyError";
      this.status = status;
    }
  },
  createInitiatedUpload: mockCreateUpload,
}));

function postWith(body: Record<string, unknown>) {
  const req = new Request("http://localhost:3000/api/upload/initiate", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return POST(req);
}

const base = {
  name: "photo.png",
  purpose: "message",
  size: 1024,
  type: "image/png",
};

describe("POST /api/upload/initiate (message attachments)", () => {
  beforeEach(() => {
    mockCreateUpload.mockClear();
    mockFindMember.mockClear();
  });

  test("message purpose without a conversation is rejected", async () => {
    const response = await postWith(base);
    expect(response.status).toBe(400);
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });

  test("non-members cannot initiate message uploads", async () => {
    const response = await postWith({ ...base, conversationId: "convo-nope" });
    expect(response.status).toBe(403);
    expect(mockCreateUpload).not.toHaveBeenCalled();
  });

  test("members bind the row to the conversation with dimensions", async () => {
    const response = await postWith({
      ...base,
      conversationId: "convo-1",
      height: 240,
      width: 320,
    });
    expect(response.status).toBe(200);
    expect(mockCreateUpload).toHaveBeenCalledTimes(1);
    const input = mockCreateUpload.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(input.messageConversationId).toBe("convo-1");
    expect(input.width).toBe(320);
    expect(input.height).toBe(240);
    const json = (await response.json()) as { mediaId: string };
    expect(json.mediaId).toBe("media-1");
  });

  test("non-message purposes skip the membership check", async () => {
    const response = await postWith({ ...base, purpose: "post" });
    expect(response.status).toBe(200);
    expect(mockFindMember).not.toHaveBeenCalled();
    const input = mockCreateUpload.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(input.messageConversationId).toBeNull();
  });
});
