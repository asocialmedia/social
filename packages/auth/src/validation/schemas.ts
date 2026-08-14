import { z } from "zod";

import {
  commonsequencesRegex,
  threerepeatRegex,
  whitespaceRegex,
} from "./constants";

const requiredUsername = z
  .string()
  .trim()
  .min(1, "Username is required, pick something cool!");
const requiredEmail = z
  .string()
  .trim()
  .min(1, "Email is required, we need to reach you!");
const requiredPassword = z
  .string()
  .trim()
  .min(1, "Password is required, keep it safe!");
const requiredString = z.string().trim().min(1, "This field is required!");

export const signUpSchema = z.object({
  email: requiredEmail.email("Please enter a valid email address"),
  password: requiredPassword
    .min(8, "Password needs at least 8 characters, keep it 100")
    .regex(/[A-Z]/, "Need at least one uppercase letter (be fancy!)")
    .regex(/[a-z]/, "Need at least one lowercase letter (keep it real!)")
    .regex(/[0-9]/, "Need at least one number (math time!)")
    .regex(/[@$!%*?&#]/, "Need at least one special character (be spicy!)")
    .refine(
      (password) => !threerepeatRegex.test(password),
      "No spamming the same letter 3+ times (that's not cute anymore)"
    )
    .refine(
      (password) => !commonsequencesRegex.test(password),
      "ABC or 123? Nah, be more creative than that!"
    )
    .refine((password) => {
      const commonWords = ["password", "admin", "user", "login"];
      return !commonWords.some((word) => password.toLowerCase().includes(word));
    }, "'password123' is so last season, pick something better!"),
  username: requiredUsername.regex(
    /^[a-zA-Z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores (no weird symbols pls)"
  ),
});

export const loginSchema = z.object({
  password: requiredPassword,
  username: requiredUsername,
});

export const createPostSchema = z.object({
  content: requiredString,
  mediaIds: z.array(z.string()).max(5, "Cannot have more than 5 attachments"),
  mentions: z.array(z.string()).default([]),
  tags: z.array(z.string()),
});

const socialUsername = z
  .string()
  .trim()
  .max(50, "That username is too long, keep it under 50 characters")
  .regex(
    /^[a-zA-Z0-9_.-]*$/,
    "Only letters, numbers, dots, dashes, and underscores allowed"
  )
  .optional();

export const updateUserProfileSchema = z.object({
  bio: z
    .string()
    .max(2000, "Bio must be at most 2000 characters")
    .refine(
      (text) =>
        text.trim().split(whitespaceRegex).filter(Boolean).length <= 400,
      "Bio must not exceed 400 words"
    ),
  displayName: requiredString,
  githubUsername: socialUsername,
  linkedinUsername: socialUsername,
  redditUsername: socialUsername,
  twitterUsername: socialUsername,
});

export const createCommentSchema = z.object({
  content: requiredString,
  mediaIds: z
    .array(z.string())
    .max(4, "Cannot have more than 4 attachments")
    .default([]),
  parentId: z.string().optional(),
});

export type SignUpValues = z.infer<typeof signUpSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
export type UpdateUserProfileValues = z.infer<typeof updateUserProfileSchema>;
export type CreateCommentValues = z.infer<typeof createCommentSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
