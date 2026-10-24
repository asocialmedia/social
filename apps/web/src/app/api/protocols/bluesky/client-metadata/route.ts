import { blueskyOAuthOrigin } from "@/lib/protocols/oauth";
import { blueskyOAuthMetadata } from "@/lib/protocols/oauth-config";

export function GET() {
  return Response.json(blueskyOAuthMetadata(blueskyOAuthOrigin()));
}
