// Native twin of web's useBlueskyProfile: the full Bluesky author record
// (banner included, which post authors usually lack). Shares the keyed
// resource with the external profile screen, so opening one warms the other.
import { externalAuthorSchema } from "@asm/protocols/discovery";

import { networkRequest } from "@/features/network/lib/network-api";
import { useProtocolResource } from "@/features/network/state/use-protocol-resource";

export function useBlueskyProfile(actor: string) {
  return useProtocolResource(
    `bluesky-profile:${actor}`,
    async (signal) =>
      externalAuthorSchema.parse(
        await networkRequest(
          `/api/protocols/bluesky/profile?${new URLSearchParams({ actor })}`,
          { signal }
        )
      ),
    Boolean(actor),
    // Web's useBlueskyProfile keeps the author record for 60s.
    60_000
  );
}
