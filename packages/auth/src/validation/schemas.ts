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

// Display names end up in SEO/JSON-LD contexts and profile pages, so strip
// angle brackets outright: they carry no typographic value and remove an
// entire class of injection sinks. The length cap keeps the name readable in
// every surface (feed, tooltip, OG image) and bounds what the DB stores.
const safeDisplayString = z
  .string()
  .trim()
  .min(1, "This field is required!")
  .max(50, "Display name must be at most 50 characters")
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

export const newPasswordSchema = requiredPassword
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
  }, "'password123' is so last season, pick something better!");

export const signUpSchema = z.object({
  email: requiredEmail.email("Please enter a valid email address"),
  password: newPasswordSchema,
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
  // Set when publishing INTO a community (native community post). The publish
  // path verifies ACTIVE membership before honoring it.
  communityId: z.string().optional(),
  // Set when resharing a community post onto the global feed. The publish path
  // records a CommunityPostShare side row linking the new post to the source.
  communitySharePostId: z.string().optional(),
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
  // Set when this post is a response to another post. Responses are always
  // fleets (a gust carries one vertical video, which has no thread meaning),
  // so the publish path forces isGust off whenever this is present.
  parentPostId: z.string().optional(),
  tags: z.array(postTagSchema).max(10, "Cannot have more than 10 tags"),
});

export const createPostSchema = createPostShape.refine(
  (input) =>
    input.mediaIds.length > 0 ||
    (input.content ?? "").trim().length > 0 ||
    // A pure community reshare carries no caption of its own; the source card
    // supplies the content.
    Boolean(input.communitySharePostId),
  "A post needs either a caption or an attachment"
);

// Gust captions are short by design - one punchy line under the clip,
// measured in words rather than characters. A character cap also guards
// against a single unbroken "spam" word (e.g. "aaaaaa...") slipping through
// the word count as one word.
export const GUST_CAPTION_MAX_WORDS = 150;
export const GUST_CAPTION_MAX_CHARS = 900;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Gusts must carry exactly one video and an optional short caption.
export const createGustSchema = createPostShape
  .safeExtend({
    content: z
      .string()
      .max(
        GUST_CAPTION_MAX_CHARS,
        `Gust caption must be at most ${GUST_CAPTION_MAX_CHARS} characters`
      )
      .refine(
        (text) => !text || countWords(text) <= GUST_CAPTION_MAX_WORDS,
        `Gust caption must be at most ${GUST_CAPTION_MAX_WORDS} words`
      )
      .optional()
      .default(""),
  })
  .refine(
    (input) => input.mediaIds.length === 1,
    "A gust needs exactly one video attachment"
  );

// Community creation. Limits mirror COMMUNITY_LIMITS in @asm/db; kept literal
// here so this package stays dependency-free. Slug charset is validated again
// server-side against the reserved list.
export const COMMUNITY_TOPIC_KEYS = [
  "anime",
  "art",
  "business",
  "collectibles",
  "education",
  "fashion",
  "food",
  "games",
  "health",
  "home",
  "humanities",
  "identity",
  "internet",
  "movies",
  "music",
  "nature",
  "news",
  "places",
  "popculture",
  "qanda",
  "reading",
  "sciences",
  "spooky",
  "sports",
  "technology",
  "vehicles",
  "wellness",
  "adult",
  "mature",
] as const;

export const COMMUNITY_ACCENT_KEYS = [
  "ember",
  "clay",
  "sand",
  "moss",
  "pine",
  "ocean",
  "denim",
  "iris",
  "plum",
  "rose",
  "stone",
  "slate",
] as const;

export const createCommunitySchema = z.object({
  accentColor: z.enum(COMMUNITY_ACCENT_KEYS).default("slate"),
  description: z
    .string()
    .trim()
    .min(1, "Add a description so people know what this is about")
    .max(500, "Description must be at most 500 characters"),
  mature: z.boolean().optional().default(false),
  name: z
    .string()
    .trim()
    .min(3, "Community name must be at least 3 characters")
    .max(21, "Community name must be at most 21 characters"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Community address must be at least 3 characters")
    .max(21, "Community address must be at most 21 characters")
    .regex(/^[a-z0-9_]+$/, "Only lowercase letters, numbers, and underscores"),
  topics: z
    .array(z.enum(COMMUNITY_TOPIC_KEYS))
    .min(1, "Pick at least one topic")
    .max(5, "Pick at most 5 topics"),
  type: z.enum(["PUBLIC", "RESTRICTED", "PRIVATE"]).default("PUBLIC"),
});

export type CreateCommunityValues = z.infer<typeof createCommunitySchema>;

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

export const MAX_COMMENT_CHARS = 10_000;
export const MAX_COMMENT_WORDS = 2000;

export const createCommentSchema = z
  .object({
    content: z
      .string()
      .max(
        MAX_COMMENT_CHARS,
        `An eddie must be at most ${MAX_COMMENT_CHARS} characters`
      )
      .refine(
        (text) => !text || countWords(text) <= MAX_COMMENT_WORDS,
        `An eddie must be at most ${MAX_COMMENT_WORDS} words`
      )
      .optional()
      .default(""),
    mediaIds: z
      .array(z.string())
      .max(1, "An eddie can have at most 1 attachment")
      .default([]),
    parentId: z.string().optional(),
  })
  .refine(
    (input) =>
      input.mediaIds.length > 0 || (input.content ?? "").trim().length > 0,
    "An eddie needs either text or an attachment"
  );

export type SignUpValues = z.infer<typeof signUpSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
export type UpdateUserProfileValues = z.infer<typeof updateUserProfileSchema>;
export type CreateCommentValues = z.infer<typeof createCommentSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
