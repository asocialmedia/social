import { z } from "zod";

export const BLUESKY_NATIVE_RETURN = "asocialmedia://settings";
interface NativeAuthorizationTransport {
  digest: (verifier: string) => Promise<string>;
  randomId: () => string;
  request: (path: string, init: RequestInit) => Promise<unknown>;
  openBrowser: (
    url: string,
    returnUrl: string
  ) => Promise<{ type: string; url?: string }>;
}
export async function authorizeNativeBluesky(
  handle: string,
  transport: NativeAuthorizationTransport
): Promise<string | null> {
  const verifier = `${transport.randomId()}${transport.randomId()}`;
  const state = transport.randomId();
  const challenge = await transport.digest(verifier);
  const start = z.object({ url: z.url() }).parse(
    await transport.request("/api/protocols/bluesky/oauth/native", {
      body: JSON.stringify({ challenge, handle: handle.trim(), state }),
      method: "POST",
    })
  );
  const result = await transport.openBrowser(start.url, BLUESKY_NATIVE_RETURN);
  if (result.type !== "success") {
    return null;
  }
  const returned = new URL(result.url ?? "");
  const expected = new URL(BLUESKY_NATIVE_RETURN);
  if (
    returned.protocol !== expected.protocol ||
    returned.host !== expected.host ||
    returned.pathname !== expected.pathname ||
    returned.searchParams.get("state") !== state
  ) {
    throw new Error("Unexpected authorization return. Try again.");
  }
  const code = returned.searchParams.get("code");
  if (!code || returned.searchParams.get("bluesky") !== "authorized") {
    throw new Error("Bluesky authorization was cancelled or expired.");
  }
  const saved = z.object({ handle: z.string() }).parse(
    await transport.request("/api/protocols/bluesky/oauth/native", {
      body: JSON.stringify({ code, verifier }),
      method: "POST",
    })
  );
  return saved.handle;
}
