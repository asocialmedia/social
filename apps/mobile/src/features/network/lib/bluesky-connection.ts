import { z } from "zod";

export const blueskyConnectionSchema = z.object({
  canLike: z.boolean(),
  canReply: z.boolean(),
  connected: z.boolean(),
  did: z.string().nullable(),
});
