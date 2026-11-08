import { afterAll, expect, mock, test } from "bun:test";

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { useMediaQuery } from "./use-media-query";

const dom = new Window();
const media = dom.matchMedia("(min-width: 80rem)");
let wide = false;
Object.defineProperty(media, "matches", { get: () => wide });
Object.defineProperty(dom, "matchMedia", { value: () => media });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

function ServerProbe({ serverMatch = false }: { serverMatch?: boolean }) {
  return <output>{String(useMediaQuery("all", serverMatch))}</output>;
}
function QueryProbe({ read }: { read: () => Promise<string> }) {
  const enabled = useMediaQuery("(min-width: 80rem)");
  const query = useQuery({
    enabled,
    queryFn: read,
    queryKey: ["sidebar-visibility"],
    retry: false,
    staleTime: Infinity,
  });
  return <output>{query.data ?? "Loading"}</output>;
}

test("existing layout queries retain their narrow server snapshot", () => {
  expect(renderToStaticMarkup(<ServerProbe />)).toContain(">false</output>");
});
test("an always-visible widget can retain its previous server markup", () => {
  expect(renderToStaticMarkup(<ServerProbe serverMatch />)).toContain(
    ">true</output>"
  );
});
test("hidden widget queries wait for the viewport and stop refetching when hidden again", async () => {
  wide = false;
  const read = mock(() => Promise.resolve("Widget data"));
  const client = new QueryClient();
  const host = dom.document.createElement("div");
  const root = createRoot(host as unknown as HTMLElement);
  const resize = async (matches: boolean) => {
    await act(async () => {
      wide = matches;
      media.dispatchEvent(new dom.Event("change"));
      await Bun.sleep(20);
    });
  };
  try {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <QueryProbe read={read} />
        </QueryClientProvider>
      )
    );
    expect(read).not.toHaveBeenCalled();
    await resize(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Widget data");
    await resize(false);
    await act(() =>
      client.invalidateQueries({ queryKey: ["sidebar-visibility"] })
    );
    expect(read).toHaveBeenCalledTimes(1);
    await resize(true);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    await act(() => root.unmount());
    client.clear();
    wide = false;
  }
});
