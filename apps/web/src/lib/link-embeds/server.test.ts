import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Resolver tests: the SSRF guard and platform routing against a mocked
// fetch/DNS/Redis surface. Private targets must never reach fetch; public
// targets resolve through the youtube/X/OpenGraph paths.

let dnsRecords: { address: string }[] = [];
let fetchCalls: string[] = [];
const responses = new Map<
  string,
  {
    body?: string | Record<string, unknown>;
    status?: number;
    contentType?: string;
    location?: string;
  }
>();

const realFetch = globalThis.fetch;

mock.module("@asm/db", () => ({
  redis: {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
  },
}));

mock.module("node:dns/promises", () => ({
  lookup: (_host: string, _options: unknown) =>
    Promise.resolve(
      dnsRecords.length > 0 ? dnsRecords : [{ address: "93.184.216.34" }]
    ),
}));

beforeEach(() => {
  dnsRecords = [{ address: "93.184.216.34" }];
  fetchCalls = [];
  responses.clear();
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : String(input);
    fetchCalls.push(url);
    const config = responses.get(url) ?? responses.get("*");
    if (!config) {
      return new Response("not found", { status: 404 });
    }
    const body =
      typeof config.body === "string"
        ? config.body
        : JSON.stringify(config.body ?? {});
    if (config.location) {
      return new Response(null, {
        headers: { location: config.location },
        status: config.status ?? 302,
      });
    }
    return new Response(body, {
      headers: { "content-type": config.contentType ?? "text/html" },
      status: config.status ?? 200,
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const { resolveLinkEmbed } = await import("./server");

function ytVideoUrl(id: string): string {
  return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
}

describe("resolveLinkEmbed", () => {
  test("youtube links resolve through oEmbed with title + author", async () => {
    responses.set(ytVideoUrl("dQw4w9WgXcQ"), {
      body: {
        author_name: "Rick Astley",
        title: "Never Gonna Give You Up",
      },
      contentType: "application/json",
    });
    const embed = await resolveLinkEmbed("https://youtu.be/dQw4w9WgXcQ?si=x");
    expect(embed?.type).toBe("youtube");
    expect(embed?.videoId).toBe("dQw4w9WgXcQ");
    expect(embed?.title).toBe("Never Gonna Give You Up");
    expect(embed?.videoAuthor).toBe("Rick Astley");
    expect(embed?.url).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  test("generic sites resolve through the OpenGraph scrape", async () => {
    responses.set("https://example.com/article", {
      body: `<meta property="og:title" content="An Article"><meta property="og:description" content="Text"><meta property="og:image" content="/img.png">`,
      contentType: "text/html",
    });
    const embed = await resolveLinkEmbed(
      "https://example.com/article?utm_source=spam"
    );
    expect(embed?.type).toBe("link");
    expect(embed?.title).toBe("An Article");
    expect(embed?.imageUrl).toBe("https://example.com/img.png");
    // Tracking params were stripped before the fetch.
    expect(fetchCalls[0]).toBe("https://example.com/article");
  });

  test("redirect targets are re-validated (SSRF hop guard)", async () => {
    responses.set("https://public.example.com/redirect", {
      contentType: "text/html",
      location: "http://169.254.169.254/latest/meta-data/",
      status: 302,
    });
    const embed = await resolveLinkEmbed("https://public.example.com/redirect");
    expect(embed).toBeNull();
    // Only the first hop ever hit fetch; the private target was refused.
    expect(fetchCalls).toHaveLength(1);
  });

  test("private hostnames and private IP literals fail closed", async () => {
    expect(await resolveLinkEmbed("http://localhost:6379/")).toBeNull();
    expect(await resolveLinkEmbed("http://10.0.0.15/admin")).toBeNull();
    expect(
      await resolveLinkEmbed("http://metadata.google.internal/computeMetadata")
    ).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test("DNS pointing at a private address fails closed", async () => {
    dnsRecords = [{ address: "192.168.0.10" }];
    expect(await resolveLinkEmbed("https://rebind.example.com/")).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test("unresolvable/unknown URLs return null without throwing", async () => {
    expect(await resolveLinkEmbed("not a url at all")).toBeNull();
    expect(await resolveLinkEmbed("https://dead.example.net/nope")).toBeNull();
  });
});
