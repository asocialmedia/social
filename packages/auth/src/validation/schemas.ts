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

// Display names end up in SEO/JSON-LD contexts and profile pages, so strip
// angle brackets outright: they carry no typographic value and remove an
// entire class of injection sinks.
const safeDisplayString = z
  .string()
  .trim()
  .min(1, "This field is required!")
  .refine(
    (value) => !/[<>]/.test(value),
    "Angle brackets are not allowed here"
  );

// Post tags flow into JSON-LD keywords and hashtag URLs; keep them short,
// bracket-free, and hashtag-shaped.
const postTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(50, "Tags must be at most 50 characters")
  .regex(/^[^<>{}"']+$/, "Tags cannot contain brackets or quotes");

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
  username: requiredUsername
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores (no weird symbols pls)"
    )
    .refine(
      (username) => username.toLowerCase() !== "zeph",
      "That username is taken, try something else"
    ),
});

export const loginSchema = z.object({
  password: requiredPassword,
  username: requiredUsername,
});

// Base shape WITHOUT cross-field refinements: Zod 4 forbids extending an
// object schema that carries refinements, so the gust variant builds from
// this plain shape via .safeExtend().
const createPostShape = z.object({
  // Caption is optional for fleet posts that carry media - a lone photo or
  // clip speaks for itself. The refine on createPostSchema enforces
  // "text or attachment".
  content: z.string().optional().default(""),
  // Links the author dismissed in the composer's live preview; the publish
  // path excludes them from the stored embed set. Capped like MAX_POST_EMBEDS.
  dismissedEmbedUrls: z.array(z.string().max(2048)).max(5).optional(),
  isGust: z.boolean().optional().default(false),
  // Mirrors MAX_POST_ATTACHMENTS in @asm/media (kept literal here so the
  // validation package stays dependency-free).
  mediaIds: z.array(z.string()).max(10, "Cannot have more than 10 attachments"),
  mentions: z.array(z.string()).default([]),
  tags: z.array(postTagSchema).max(10, "Cannot have more than 10 tags"),
});

export const createPostSchema = createPostShape.refine(
  (input) =>
    input.mediaIds.length > 0 || (input.content ?? "").trim().length > 0,
  "A post needs either a caption or an attachment"
);

// Gust captions are short by design - one punchy line under the clip,
// measured in words rather than characters. A character cap also guards
// against a single unbroken "spam" word (e.g. "aaaaaa...") slipping through
// the word count as one word.
export const GUST_CAPTION_MAX_WORDS = 150;
export const GUST_CAPTION_MAX_CHARS = 900;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Gusts must carry exactly one video and a short caption.
export const createGustSchema = createPostShape
  .safeExtend({
    content: requiredString
      .max(
        GUST_CAPTION_MAX_CHARS,
        `Gust caption must be at most ${GUST_CAPTION_MAX_CHARS} characters`
      )
      .refine(
        (text) => countWords(text) <= GUST_CAPTION_MAX_WORDS,
        `Gust caption must be at most ${GUST_CAPTION_MAX_WORDS} words`
      ),
  })
  .refine(
    (input) => input.mediaIds.length === 1,
    "A gust needs exactly one video attachment"
  );

const socialUsername = z
  .string()
  .trim()
  .max(50, "That username is too long, keep it under 50 characters")
  .regex(
    /^[a-zA-Z0-9_.-]*$/,
    "Only letters, numbers, dots, dashes, and underscores allowed"
  )
  .optional();

// A custom domain like "example.com" (scheme optional, stored bare).
const customDomain = z
  .string()
  .trim()
  .max(100, "That domain is too long, keep it under 100 characters")
  .regex(
    /^(?:https?:\/\/)?[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/,
    "Enter a valid domain like example.com"
  )
  .optional()
  .or(z.literal(""));

export const updateUserProfileSchema = z.object({
  bio: z
    .string()
    .max(2000, "Bio must be at most 2000 characters")
    .refine(
      (text) =>
        text.trim().split(whitespaceRegex).filter(Boolean).length <= 400,
      "Bio must not exceed 400 words"
    ),
  customDomain,
  displayName: safeDisplayString,
  githubUsername: socialUsername,
  linkedinUsername: socialUsername,
  redditUsername: socialUsername,
  twitterUsername: socialUsername,
});

export const createCommentSchema = z.object({
  content: requiredString,
  mediaIds: z
    .array(z.string())
    .max(1, "An eddie can have at most 1 attachment")
    .default([]),
  parentId: z.string().optional(),
});

export type SignUpValues = z.infer<typeof signUpSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
export type UpdateUserProfileValues = z.infer<typeof updateUserProfileSchema>;
export type CreateCommentValues = z.infer<typeof createCommentSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
