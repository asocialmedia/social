import { mkdir } from "node:fs/promises";
import path from "node:path";

export function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((match) =>
    (match[1] ?? "").trim().replaceAll("&amp;", "&")
  );
}

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
      (match) => [(match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? ""]
    )
  );
}

export function inspectSeoHtml(html: string) {
  const markup = html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const tags = [...markup.matchAll(/<(?:meta|link)\b[^>]*>/gi)].map((match) =>
    attributes(match[0])
  );
  const canonicals = tags
    .filter((tag) => tag.rel === "canonical")
    .map((tag) => tag.href ?? "");
  const robots = tags
    .filter((tag) =>
      ["robots", "googlebot"].includes(tag.name?.toLowerCase() ?? "")
    )
    .map((tag) => tag.content ?? "");
  return {
    canonicals,
    description:
      tags.find((tag) => tag.name === "description")?.content ?? null,
    hasArticle: /<article\b/i.test(markup),
    noindex: robots.some((value) => /\bnoindex\b|\bnone\b/i.test(value)),
    postLinks: [
      ...new Set(
        [
          ...markup.matchAll(
            /<a\b[^>]*\bhref="([^"#]*\/posts(?:\/[^"#]*)?)"/gi
          ),
        ].map((match) => match[1])
      ),
    ],
    robots,
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(markup)?.[1] ?? null,
  };
}

async function audit(base: string, output: string) {
  const origin = new URL(base).origin;
  const results: Record<string, unknown>[] = [];
  const read = async (url: string) => {
    const started = performance.now();
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    results.push({
      bytes: Buffer.byteLength(body),
      contentType: response.headers.get("content-type"),
      elapsedMs: Math.round(performance.now() - started),
      finalUrl: response.url,
      status: response.status,
      url,
      xRobotsTag: response.headers.get("x-robots-tag"),
      ...(response.headers.get("content-type")?.includes("text/html")
        ? inspectSeoHtml(body)
        : { locations: sitemapLocations(body) }),
    });
    return body;
  };
  const index = await read(`${origin}/sitemap.xml`);
  const children = sitemapLocations(index);
  const samples: string[] = [];
  for (const child of children) {
    if (new URL(child).origin !== origin) {
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- keep the public crawl deliberately sequential and bounded.
    const xml = await read(child);
    samples.push(
      ...sitemapLocations(xml)
        .filter((url) => new URL(url).origin === origin)
        .slice(0, 3)
    );
  }
  const urls = [
    ...new Set([
      `${origin}/`,
      `${origin}/discover`,
      `${origin}/about`,
      `${origin}/robots.txt`,
      `${origin}/gusts?id=seo-audit-missing-post`,
      `${origin}/network/bluesky`,
      ...samples,
    ]),
  ].slice(0, 30);
  for (const url of urls) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- avoid adding a concurrent crawler load to production.
      await read(url);
    } catch (error) {
      results.push({
        error: error instanceof Error ? error.message : String(error),
        url,
      });
    }
  }
  await mkdir(path.dirname(output), { recursive: true });
  await Bun.write(
    output,
    `${JSON.stringify({ base: origin, checkedAt: new Date().toISOString(), note: "Read-only HTTP audit using a Googlebot user agent. This does not establish Google's indexing status or test JavaScript rendering.", results }, null, 2)}\n`
  );
  console.log(`Saved ${results.length} HTTP checks to ${output}`);
}

if (import.meta.main) {
  await audit(
    process.argv[2] ?? "https://asocialmedia.cc",
    process.argv[3] ?? "artifacts/seo-audit/report.json"
  );
}
