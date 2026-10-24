import { redis } from "@asm/db";
import { RedisBoundedStore } from "@asm/protocols/discovery";

export const followingStore = new RedisBoundedStore(redis, {
  maxBytes: 32 * 1024 * 1024,
  maxEntries: 512,
  maxValueBytes: 8 * 1024 * 1024,
  scope: "asm:protocols:{following:v1}",
});
