import { describe, expect, test } from "bun:test";
import {
  createCommentSchema,
  createPostSchema,
  loginSchema,
  signUpSchema,
  updateUserProfileSchema,
} from "./schemas";

describe("schemas", () => {
  describe("signUpSchema", () => {
    test("validates valid input", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        username: "valid_user_123",
        password: "SecureL0ck#99x",
      });
      expect(result.success).toBe(true);
    });

    test("rejects invalid email", () => {
      const result = signUpSchema.safeParse({
        email: "notanemail",
        username: "valid_user_123",
        password: "SecureL0ck#99x",
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
        username: "invalid-user!",
        password: "SecureL0ck#99x",
      });
      expect(result.success).toBe(false);
    });

    test("rejects weak password (no special char)", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        username: "valid_user_123",
        password: "SecureL0ck99x",
      });
      expect(result.success).toBe(false);
    });

    test("rejects weak password (too short)", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        username: "valid_user_123",
        password: "Va1!",
      });
      expect(result.success).toBe(false);
    });

    test("rejects password with 3 repeating chars", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        username: "valid_user_123",
        password: "SecureL0ck#99xaaa",
      });
      expect(result.success).toBe(false);
    });

    test("rejects password with common sequences", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        username: "valid_user_123",
        password: "SecureL0ck#99x123",
      });
      expect(result.success).toBe(false);
    });

    test("rejects password with common words", () => {
      const result = signUpSchema.safeParse({
        email: "hello@example.com",
        username: "valid_user_123",
        password: "MyPassword1!#",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("loginSchema", () => {
    test("validates valid login", () => {
      expect(
        loginSchema.safeParse({ username: "user", password: "password" })
          .success
      ).toBe(true);
    });
    test("rejects empty fields", () => {
      expect(
        loginSchema.safeParse({ username: "", password: "" }).success
      ).toBe(false);
    });
  });

  describe("createPostSchema", () => {
    test("validates valid post", () => {
      expect(
        createPostSchema.safeParse({
          content: "Hello world!",
          mediaIds: ["id1"],
          tags: ["tag1"],
          mentions: [],
        }).success
      ).toBe(true);
    });

    test("rejects more than 5 mediaIds", () => {
      expect(
        createPostSchema.safeParse({
          content: "Hello world!",
          mediaIds: ["1", "2", "3", "4", "5", "6"],
          tags: [],
          mentions: [],
        }).success
      ).toBe(false);
    });
  });

  describe("updateUserProfileSchema", () => {
    test("validates valid profile update", () => {
      expect(
        updateUserProfileSchema.safeParse({
          displayName: "New Name",
          bio: "This is a cool bio",
        }).success
      ).toBe(true);
    });

    test("rejects bio longer than 2000 chars", () => {
      expect(
        updateUserProfileSchema.safeParse({
          displayName: "Name",
          bio: "a".repeat(2001),
        }).success
      ).toBe(false);
    });

    test("rejects bio with more than 400 words", () => {
      expect(
        updateUserProfileSchema.safeParse({
          displayName: "Name",
          bio: "word ".repeat(401),
        }).success
      ).toBe(false);
    });

    test("accepts optional social usernames", () => {
      const result = updateUserProfileSchema.safeParse({
        displayName: "Name",
        bio: "",
        githubUsername: "octocat",
        linkedinUsername: "john-doe",
        twitterUsername: "user_123",
        redditUsername: "user.123",
      });
      expect(result.success).toBe(true);
    });

    test("accepts missing social usernames", () => {
      const result = updateUserProfileSchema.safeParse({
        displayName: "Name",
        bio: "",
      });
      expect(result.success).toBe(true);
    });

    test("rejects social usernames with invalid characters", () => {
      const result = updateUserProfileSchema.safeParse({
        displayName: "Name",
        bio: "",
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
    test("rejects empty comment", () => {
      expect(createCommentSchema.safeParse({ content: "" }).success).toBe(
        false
      );
    });
  });
});
