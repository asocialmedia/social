import { expect, test } from "bun:test";

import { createKnowledgeTopicProvider } from "./knowledge-topics";

test("starter topics and ten related children come from provider responses, with aliases bound to the canonical page", async () => {
  const urls: URL[] = [];
  const provider = createKnowledgeTopicProvider({
    fetch: (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.get("prop") === "pageprops") {
        return Response.json({
          query: {
            pages: [{ pageprops: { wikibase_item: "Q8274" }, title: "Manga" }],
          },
        });
      }
      if (url.searchParams.get("action") === "wbgetentities") {
        return Response.json({
          entities: {
            Q8274: {
              aliases: { en: [{ value: "Japanese-style comics" }] },
              sitelinks: { enwiki: { title: "Manga" } },
            },
          },
        });
      }
      if (url.searchParams.get("list") === "search") {
        return Response.json({
          query: {
            search: Array.from({ length: 15 }, (_, index) => ({
              title: `Related work ${index}`,
            })),
          },
        });
      }
      return Response.json({
        query: {
          categorymembers: [
            { title: "Category:Live changing topic" },
            { title: "Category:Another provider topic" },
          ],
        },
      });
    },
  });
  const roots = await provider.browse();
  expect(roots.items.map((entry) => entry.label)).toEqual([
    "Live changing topic",
    "Another provider topic",
  ]);
  const children = await provider.browse("manga");
  expect(children.items).toHaveLength(10);
  expect(children.aliases).toContain("Japanese-style comics");
  expect(
    urls.some((url) => url.searchParams.get("srsearch") === "morelike:Manga")
  ).toBe(true);
  expect(
    urls.some((url) => url.searchParams.get("action") === "wbsearchentities")
  ).toBe(false);
});

test("search returns live labels and descriptions, and unavailable providers do not invent fixed suggestions", async () => {
  const provider = createKnowledgeTopicProvider({
    fetch: () =>
      Promise.resolve(
        Response.json({
          search: [
            {
              description: "Provider description",
              id: "Q42",
              label: "Unusual subject",
            },
          ],
        })
      ),
  });
  const result = await provider.search("unusual");
  expect(result.items[0]?.label).toBe("Unusual subject");
  expect(result.items[0]?.description).toBe("Provider description");
  const offline = createKnowledgeTopicProvider({
    fetch: () => Promise.resolve(new Response("offline", { status: 503 })),
  });
  await expect(offline.browse()).rejects.toThrow("temporarily unavailable");
});

test("a topic expands from either relationship source while recording partial failure", async () => {
  const provider = createKnowledgeTopicProvider({
    fetch: (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get("list") === "categorymembers") {
        return Response.json({
          query: { categorymembers: [{ title: "Category:Observed child" }] },
        });
      }
      return new Response("offline", { status: 503 });
    },
  });
  const result = await provider.browse("Unusual root");
  expect(result.items.map((entry) => entry.label)).toEqual(["Observed child"]);
  expect(result.partial).toBe(true);
});

test("administrative redirect categories are excluded without rejecting article concepts", async () => {
  const provider = createKnowledgeTopicProvider({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("list") === "categorymembers") {
        return Response.json({
          query: {
            categorymembers: [
              { ns: 14, title: "Category:Anime and manga redirects" },
              { ns: 0, title: "HTTP redirects" },
              { ns: 14, title: "Category:Anime series" },
            ],
          },
        });
      }
      return new Response("offline", { status: 503 });
    },
  });
  const roots = await provider.browse();
  expect(roots.items.map((entry) => entry.label)).toEqual([
    "HTTP redirects",
    "Anime series",
  ]);
  const related = await provider.browse("anime");
  expect(related.items.map((entry) => entry.label)).toEqual([
    "HTTP redirects",
    "Anime series",
  ]);
  expect(related.relatedTerms).toEqual(["HTTP redirects", "Anime series"]);
});
