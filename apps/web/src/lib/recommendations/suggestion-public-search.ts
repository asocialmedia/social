import { redis } from "@asm/db";
import { createRedisReadStore } from "@asm/protocols/discovery";

import { readBlueskySearch } from "@/lib/protocols/service";

import { createSuggestionPublicSearch } from "./public-search-cache";

export const readSuggestionPublicSearch = createSuggestionPublicSearch(
  createRedisReadStore(redis),
  readBlueskySearch
);
