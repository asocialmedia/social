import wikibaseSdk, { isItemId } from "wikibase-sdk";
import { z } from "zod";

import { normalizeInterest } from "./network-preferences";
import type { NetworkTopic, NetworkTopicPage } from "./network-topics";
import { readJsonBounded } from "./transport";

const encyclopedia = "https://en.wikipedia.org/w/api.php";
const wikibase = wikibaseSdk({ instance: "https://www.wikidata.org" });
const memberSchema = z.object({ ns: z.number().optional(), title: z.string() });
const querySchema = z.object({
  query: z
    .object({
      categorymembers: z.array(memberSchema).optional(),
      search: z.array(memberSchema).optional(),
    })
    .optional(),
});
const entitySearchSchema = z.object({
  search: z.array(
    z.object({
      description: z.string().optional(),
      id: z.string().regex(/^Q\d+$/u),
      label: z.string(),
    })
  ),
});
const entitiesSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      aliases: z
        .record(z.string(), z.array(z.object({ value: z.string() })))
        .optional(),
      claims: z
        .record(
          z.string(),
          z.array(
            z.object({
              mainsnak: z.object({
                datavalue: z.object({ value: z.unknown() }).optional(),
              }),
            })
          )
        )
        .optional(),
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      sitelinks: z
        .record(z.string(), z.object({ title: z.string() }))
        .optional(),
    })
  ),
});

function topic(title: string, description?: string): NetworkTopic | null {
  const label = title.replace(/^Category:/u, "").trim();
  if (label.length < 2 || label.length > 64) {
    return null;
  }
  return { aliases: [], description, id: title, label, source: "wikimedia" };
}

const comparable = (text: string) => normalizeInterest(text).replace(/s$/u, "");

// Only public topic metadata is read. No post bodies or viewer information are sent upstream.
export function createKnowledgeTopicProvider(
  options: {
    fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
    timeoutMs?: number;
  } = {}
) {
  const transport = options.fetch ?? fetch;
  async function read(url: string, signal?: AbortSignal) {
    const bounded = signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(options.timeoutMs ?? 3500),
        ])
      : AbortSignal.timeout(options.timeoutMs ?? 3500);
    const response = await transport(url, {
      headers: {
        "user-agent":
          "ASM/1.0 (https://asocialmedia.cc; public-topic-discovery)",
      },
      redirect: "error",
      signal: bounded,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Topic provider is temporarily unavailable");
    }
    return readJsonBounded(response, 512 * 1024, bounded);
  }
  function wikiUrl(parameters: Record<string, string>) {
    const url = new URL(encyclopedia);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      maxlag: "5",
      ...parameters,
    }).toString();
    return url.toString();
  }
  async function members(title: string, signal?: AbortSignal) {
    const data = querySchema.parse(
      await read(
        wikiUrl({
          cmlimit:
            title === "Category:Main topic classifications" ? "40" : "200",
          cmtitle: title.startsWith("Category:") ? title : `Category:${title}`,
          cmtype:
            title === "Category:Main topic classifications"
              ? "subcat"
              : "subcat|page",
          list: "categorymembers",
        }),
        signal
      )
    );
    return data.query?.categorymembers ?? [];
  }
  async function related(title: string, signal?: AbortSignal) {
    const data = querySchema.parse(
      await read(
        wikiUrl({
          list: "search",
          srlimit: "10",
          srprop: "",
          srsearch: `morelike:${title.replace(/^Category:/u, "")}`,
        }),
        signal
      )
    );
    return data.query?.search ?? [];
  }
  async function searchTitles(value: string, signal?: AbortSignal) {
    const data = querySchema.parse(
      await read(
        wikiUrl({ list: "search", srlimit: "10", srprop: "", srsearch: value }),
        signal
      )
    );
    return data.query?.search ?? [];
  }
  async function canonical(value: string, signal?: AbortSignal) {
    const data = z
      .object({
        query: z.object({
          pages: z.array(
            z.object({
              pageprops: z
                .object({ wikibase_item: z.string().optional() })
                .optional(),
              title: z.string(),
            })
          ),
        }),
      })
      .parse(
        await read(
          wikiUrl({
            formatversion: "2",
            prop: "pageprops",
            redirects: "1",
            titles: value,
          }),
          signal
        )
      );
    const [page] = data.query.pages;
    const id = page?.pageprops?.wikibase_item;
    if (!page || !id || !isItemId(id)) {
      const matches =
        !page || (page as { missing?: boolean }).missing
          ? await searchTitles(value, signal).catch(() => [])
          : [];
      return {
        aliases: [],
        parents: [] as NetworkTopic[],
        requiresContext: true,
        title: page?.title ?? matches[0]?.title ?? value,
      };
    }
    const entityData = entitiesSchema.parse(
      await read(
        wikibase.getEntities({
          ids: [id],
          languages: ["en"],
          props: ["labels", "aliases", "sitelinks", "claims"],
        }),
        signal
      )
    );
    const entity = entityData.entities[id];
    const aliases = [
      ...new Set([
        page.title,
        ...(entity?.aliases?.en ?? []).map((entry) => entry.value),
      ]),
    ]
      .filter((alias) => alias.length >= 2 && alias.length <= 64)
      .slice(0, 16);
    const exact = aliases.some(
      (alias) => comparable(alias) === comparable(value)
    );
    // Wikibase predicates encode creator, series, part-of and component relations; their subjects are never enumerated here.
    const relatedIds = [
      ...new Set(
        ["P178", "P179", "P361", "P527"].flatMap((property) =>
          (entity?.claims?.[property] ?? []).flatMap((claim) => {
            const item = z
              .object({ id: z.string() })
              .safeParse(claim.mainsnak.datavalue?.value);
            return item.success && isItemId(item.data.id) && item.data.id !== id
              ? [item.data.id]
              : [];
          })
        )
      ),
    ].slice(0, 10);
    const linked = relatedIds.length
      ? entitiesSchema.parse(
          await read(
            wikibase.getEntities({
              ids: relatedIds,
              languages: ["en"],
              props: ["labels", "aliases", "sitelinks"],
            }),
            signal
          )
        ).entities
      : {};
    const parents = Object.values(linked).flatMap((item) => {
      const title = item.sitelinks?.enwiki?.title ?? item.labels?.en?.value;
      const parsedTopic = title ? topic(title) : null;
      return parsedTopic
        ? [
            {
              ...parsedTopic,
              aliases: (item.aliases?.en ?? [])
                .map((alias) => alias.value)
                .filter((alias) => alias.length <= 64)
                .slice(0, 16),
            },
          ]
        : [];
    });
    return {
      aliases: exact ? aliases : [],
      parents,
      requiresContext: !exact,
      title: entity?.sitelinks?.enwiki?.title ?? page.title,
    };
  }
  return {
    async browse(
      parent?: string,
      signal?: AbortSignal
    ): Promise<NetworkTopicPage> {
      if (!parent) {
        const roots = await members(
          "Category:Main topic classifications",
          signal
        );
        return {
          aliases: [],
          items: roots
            .map((entry) => topic(entry.title))
            .filter((entry): entry is NetworkTopic => entry !== null)
            .slice(0, 40),
          parent: null,
          partial: false,
        };
      }
      const resolved = await canonical(
        parent.replace(/^Category:/u, ""),
        signal
      ).catch(() => ({
        aliases: [],
        parents: [] as NetworkTopic[],
        requiresContext: true,
        title: parent,
      }));
      const [similar, children, siblings] = await Promise.allSettled([
        related(resolved.title, signal),
        members(
          parent.startsWith("Category:") ? parent : resolved.title,
          signal
        ),
        Promise.all(
          resolved.parents.slice(0, 2).map((item) => related(item.id, signal))
        ).then((rows) => rows.flat()),
      ]);
      if (similar.status === "rejected" && children.status === "rejected") {
        throw new Error("Related topics are temporarily unavailable");
      }
      const values = [
        ...(siblings.status === "fulfilled" ? siblings.value.slice(0, 3) : []),
        ...(similar.status === "fulfilled" ? similar.value.slice(0, 6) : []),
        ...(children.status === "fulfilled" ? children.value : []),
        ...(similar.status === "fulfilled" ? similar.value.slice(6) : []),
      ];
      const items = [
        ...new Map(
          [
            ...resolved.parents,
            ...values
              .map((entry) => topic(entry.title))
              .filter((entry): entry is NetworkTopic => entry !== null),
          ]
            .filter(
              (entry) =>
                normalizeInterest(entry.label) !==
                normalizeInterest(parent.replace(/^Category:/u, ""))
            )
            .map((entry) => [normalizeInterest(entry.label), entry])
        ).values(),
      ].slice(0, 10);
      return {
        aliases: resolved.aliases,
        items,
        parent,
        partial:
          similar.status === "rejected" || children.status === "rejected",
        relatedTerms:
          children.status === "fulfilled"
            ? children.value
                .map((entry) => entry.title.replace(/^Category:/u, ""))
                .filter((label) => label.length >= 2 && label.length <= 64)
                .slice(0, 200)
            : [],
        requiresContext: resolved.requiresContext,
      };
    },
    async search(
      query: string,
      signal?: AbortSignal
    ): Promise<NetworkTopicPage> {
      const [entities, titles] = await Promise.allSettled([
        read(
          wikibase.searchEntities({ language: "en", limit: 10, search: query }),
          signal
        ).then((value) => entitySearchSchema.parse(value)),
        searchTitles(query, signal),
      ]);
      if (entities.status === "rejected" && titles.status === "rejected") {
        throw new Error("Topic search is temporarily unavailable");
      }
      const items = [
        ...new Map(
          [
            ...(titles.status === "fulfilled"
              ? titles.value.map((entry) => topic(entry.title))
              : []),
            ...(entities.status === "fulfilled"
              ? entities.value.search.map((entry) =>
                  topic(entry.label, entry.description)
                )
              : []),
          ]
            .filter((entry): entry is NetworkTopic => entry !== null)
            .map((entry) => [normalizeInterest(entry.label), entry])
        ).values(),
      ].slice(0, 10);
      return {
        aliases: [],
        items,
        parent: null,
        partial: entities.status === "rejected" || titles.status === "rejected",
      };
    },
  };
}
