import { describe, expect, test } from "bun:test";

import {
  createCommentSchema,
  createGustSchema,
  createPostSchema,
  GUST_CAPTION_MAX_CHARS,
  GUST_CAPTION_MAX_WORDS,
  loginSchema,
  signUpSchema,
  updateUserProfileSchema,
} from "./schemas";

describe("schemas", () => {
  describe("signUpSchema", () => {
    test("validates valid input", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "SecureL0ck#99x",
        username: "valid_user_123",
      });
      expect(result.success).toBe(true);
    });

    test("rejects invalid email", () => {
      const result = signUpSchema.safeParse({
        email: "notanemail",
        password: "SecureL0ck#99x",
        username: "valid_user_123",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          "Please enter a valid email address"
        );
      }
    });

    test("rejects invalid username (special chars)", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "SecureL0ck#99x",
        username: "invalid-user!",
      });
      expect(result.success).toBe(false);
    });

    test("rejects weak password (no special char)", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "SecureL0ck99x",
        username: "valid_user_123",
      });
      expect(result.success).toBe(false);
    });

    test("rejects weak password (too short)", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "Va1!",
        username: "valid_user_123",
      });
      expect(result.success).toBe(false);
    });

    test("rejects password with 3 repeating chars", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "SecureL0ck#99xaaa",
        username: "valid_user_123",
      });
      expect(result.success).toBe(false);
    });

    test("rejects password with common sequences", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "SecureL0ck#99x123",
        username: "valid_user_123",
      });
      expect(result.success).toBe(false);
    });

    test("rejects password with common words", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        password: "MyPassword1!#",
        username: "valid_user_123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    test("validates valid login", () => {
      expect(
        loginSchema.safeParse({ password: "password", username: "user" })
          .success
      ).toBe(true);
    });
    test("rejects empty fields", () => {
      expect(
        loginSchema.safeParse({ password: "", username: "" }).success
      ).toBe(false);
    });
  });

  describe("createPostSchema", () => {
    test("validates valid post", () => {
      expect(
        createPostSchema.safeParse({
          content: "Hello world!",
          mediaIds: ["id1"],
          mentions: [],
          tags: ["tag1"],
        }).success
      ).toBe(true);
    });

    test("rejects more than the 10-attachment cap (MAX_POST_ATTACHMENTS)", () => {
      expect(
        createPostSchema.safeParse({
          content: "Hello world!",
          mediaIds: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(false);
    });
  });

  describe("createGustSchema", () => {
    test("validates a gust with one video", () => {
      expect(
        createGustSchema.safeParse({
          content: "Here's my clip!",
          isGust: true,
          mediaIds: ["video1"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(true);
    });

    test("rejects a gust with more than one attachment", () => {
      expect(
        createGustSchema.safeParse({
          content: "Too much media",
          isGust: true,
          mediaIds: ["video1", "video2"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(false);
    });

    test("rejects a gust with no attachments", () => {
      expect(
        createGustSchema.safeParse({
          content: "No media",
          isGust: true,
          mediaIds: [],
          mentions: [],
          tags: [],
        }).success
      ).toBe(false);
    });

    test("rejects an oversized gust caption", () => {
      const tooManyWords = Array.from(
        { length: GUST_CAPTION_MAX_WORDS + 1 },
        () => "word"
      ).join(" ");
      expect(
        createGustSchema.safeParse({
          content: tooManyWords,
          isGust: true,
          mediaIds: ["video1"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(false);
    });

    test("accepts a gust caption at the exact max words", () => {
      const exactWords = Array.from(
        { length: GUST_CAPTION_MAX_WORDS },
        () => "word"
      ).join(" ");
      expect(
        createGustSchema.safeParse({
          content: exactWords,
          isGust: true,
          mediaIds: ["video1"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(true);
    });

    test("rejects a single spam word exceeding the char cap", () => {
      expect(
        createGustSchema.safeParse({
          content: "a".repeat(GUST_CAPTION_MAX_CHARS + 1),
          isGust: true,
          mediaIds: ["video1"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(false);
    });

    test("accepts a long single word within the char cap", () => {
      expect(
        createGustSchema.safeParse({
          content: "a".repeat(GUST_CAPTION_MAX_CHARS),
          isGust: true,
          mediaIds: ["video1"],
          mentions: [],
          tags: [],
        }).success
      ).toBe(true);
    });
  });

  describe("updateUserProfileSchema", () => {
    test("validates valid profile update", () => {
      expect(
        updateUserProfileSchema.safeParse({
          bio: "This is a cool bio",
          displayName: "New Name",
        }).success
      ).toBe(true);
    });

    test("rejects bio longer than 2000 chars", () => {
      expect(
        updateUserProfileSchema.safeParse({
          bio: "a".repeat(2001),
          displayName: "Name",
        }).success
      ).toBe(false);
    });

    test("rejects bio with more than 400 words", () => {
      expect(
        updateUserProfileSchema.safeParse({
          bio: "word ".repeat(401),
          displayName: "Name",
        }).success
      ).toBe(false);
    });

    test("accepts optional social usernames", () => {
      const result = updateUserProfileSchema.safeParse({
        bio: "",
        displayName: "Name",
        githubUsername: "octocat",
        linkedinUsername: "john-doe",
        redditUsername: "user.123",
        twitterUsername: "user_123",
      });
      expect(result.success).toBe(true);
    });

    test("accepts missing social usernames", () => {
      const result = updateUserProfileSchema.safeParse({
        bio: "",
        displayName: "Name",
      });
      expect(result.success).toBe(true);
    });

    test("rejects social usernames with invalid characters", () => {
      const result = updateUserProfileSchema.safeParse({
        bio: "",
        displayName: "Name",
        githubUsername: "bad user!",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createCommentSchema", () => {
    test("validates valid comment", () => {
      expect(
        createCommentSchema.safeParse({ content: "Great post!" }).success
      ).toBe(true);
    });
    test("validates comment with 1 attachment", () => {
      expect(
        createCommentSchema.safeParse({
          content: "Look at this GIF!",
          mediaIds: ["media1"],
        }).success
      ).toBe(true);
    });
    test("rejects comment with more than 1 attachment", () => {
      expect(
        createCommentSchema.safeParse({
          content: "Too many attachments",
          mediaIds: ["media1", "media2"],
        }).success
      ).toBe(false);
    });
    test("rejects empty comment", () => {
      expect(createCommentSchema.safeParse({ content: "" }).success).toBe(
        false
      );
    });
  });
});
