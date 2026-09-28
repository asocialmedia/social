import { describe, expect, test } from "bun:test";

import {
  PREVIEW_STALE_TIME_MS,
  createLinkPreviewResolver,
  extractPostUrls,
  sanitizeEmbedUrl,
} from "./link-preview-resolver";

const API = "https://api.test";

function okJson(payload: unknown) {
  return Promise.resolve(
    Response.json(payload, { status: 200 })
  ) as Promise<Response>;
}

const silentLog = { info: () => {}, warn: () => {} };

describe("sanitizeEmbedUrl", () => {
  test("strips tracking params but keeps meaningful ones", () => {
    expect(
      sanitizeEmbedUrl("https://example.com/a?fbclid=abc&utm_source=x")
    ).toBe("https://example.com/a");
    // YouTube's sharing params carry meaning and must survive.
    expect(sanitizeEmbedUrl("https://youtu.be/abc?t=30&si=track")).toBe(
      "https://youtu.be/abc?t=30"
    );
  });

  test("removes credentials and upgrades http for display", () => {
    expect(sanitizeEmbedUrl("http://user:pass@example.com/x")).toBe(
      "https://example.com/x"
    );
  });

  test("rejects anything that is not http(s) or is over-length", () => {
    // Assembled at runtime so the linter does not flag a script URL here.
    const scriptUrl = `java${"script"}:alert(1)`;
    expect(sanitizeEmbedUrl(scriptUrl)).toBeNull();
    expect(sanitizeEmbedUrl("ftp://example.com")).toBeNull();
    expect(sanitizeEmbedUrl("not a url")).toBeNull();
    expect(
      sanitizeEmbedUrl(`https://example.com/${"a".repeat(2100)}`)
    ).toBeNull();
  });
});

describe("extractPostUrls", () => {
  test("returns unique sanitized urls in first-appearance order", () => {
    const urls = extractPostUrls(
      "look at https://example.com/one and http://example.com/two?fbclid=z " +
        "plus https://example.com/one again"
    );
    expect(urls).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });

  test("a tracked and untracked spelling collapse to one embed", () => {
    expect(
      extractPostUrls(
        "https://example.com/p?utm_source=a https://example.com/p"
      )
    ).toEqual(["https://example.com/p"]);
  });

  test("leaves trailing sentence punctuation out of the url", () => {
    expect(extractPostUrls("see https://example.com/page.")).toEqual([
      "https://example.com/page",
    ]);
  });

  test("caps at five and tolerates empty or null bodies", () => {
    const many = Array.from(
      { length: 9 },
      (_, index) => `https://example.com/${index}`
    ).join(" ");
    expect(extractPostUrls(many)).toHaveLength(5);
    expect(extractPostUrls("")).toEqual([]);
    expect(extractPostUrls(null)).toEqual([]);
  });
});

describe("createLinkPreviewResolver", () => {
  test("resolves each url once and drops the ones that yield nothing", async () => {
    const requested: string[] = [];
    const resolver = createLinkPreviewResolver({
      apiBase: API,
      baseFetch: ((input: RequestInfo | URL) => {
        requested.push(String(input));
        return okJson({
          embed: { title: "A", type: "link", url: "https://example.com/a" },
        });
      }) as unknown as typeof fetch,
      log: silentLog,
    });
    const embeds = await resolver.loadAll("https://example.com/a");
    expect(embeds).toHaveLength(1);
    expect(embeds[0]?.title).toBe("A");
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/api/link-preview?url=");
  });

  test("an untrusted payload that fails validation renders nothing", async () => {
    // The resolver returns whatever the target page claimed; a payload with no
    // url or title must never reach the embed renderer.
    const resolver = createLinkPreviewResolver({
      apiBase: API,
      baseFetch: (() =>
        okJson({ embed: { type: "link" } })) as unknown as typeof fetch,
      log: silentLog,
    });
    expect(await resolver.loadAll("https://example.com/a")).toEqual([]);
  });

  test("a failing resolver yields no embed rather than throwing", async () => {
    const resolver = createLinkPreviewResolver({
      apiBase: API,
      baseFetch: (() =>
        Promise.resolve(
          new Response("nope", { status: 500 })
        )) as unknown as typeof fetch,
      log: silentLog,
    });
    expect(await resolver.loadAll("https://example.com/a")).toEqual([]);
  });

  test("repeat calls are served from the cache", async () => {
    let calls = 0;
    const resolver = createLinkPreviewResolver({
      apiBase: API,
      baseFetch: (() => {
        calls += 1;
        return okJson({
          embed: { title: "A", type: "link", url: "https://example.com/a" },
        });
      }) as unknown as typeof fetch,
      log: silentLog,
    });
    await resolver.loadAll("https://example.com/a");
    await resolver.loadAll("https://example.com/a");
    expect(calls).toBe(1);
  });

  test("a body with no links asks for nothing", async () => {
    let calls = 0;
    const resolver = createLinkPreviewResolver({
      apiBase: API,
      baseFetch: (() => {
        calls += 1;
        return okJson({});
      }) as unknown as typeof fetch,
      log: silentLog,
    });
    expect(await resolver.loadAll("no links here")).toEqual([]);
    expect(calls).toBe(0);
  });

  test("an expired entry is refetched", async () => {
    let calls = 0;
    let clock = 0;
    const resolver = createLinkPreviewResolver({
      apiBase: API,
      baseFetch: (() => {
        calls += 1;
        return okJson({
          embed: { title: "A", type: "link", url: "https://example.com/a" },
        });
      }) as unknown as typeof fetch,
      log: silentLog,
      now: () => clock,
    });
    await resolver.load("https://example.com/a");
    clock += 1000;
    await resolver.load("https://example.com/a");
    expect(calls).toBe(1);
    clock += PREVIEW_STALE_TIME_MS + 1;
    await resolver.load("https://example.com/a");
    expect(calls).toBe(2);
  });
});
