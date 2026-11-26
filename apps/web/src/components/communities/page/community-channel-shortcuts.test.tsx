import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

const push = mock((_href: string, _options?: { scroll: boolean }) => {});
mock.module("next/navigation", () => ({
  usePathname: () => "/a/table",
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

test("only staff can create a channel from the Posts sidebar", async () => {
  const dom = new Window({ url: "http://localhost:3000/a/table" });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let canManage = false;
  const posts: { channelType: string; name: string }[] = [];
  const fetchMock = async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/communities/table/chat/channels");
    await Promise.resolve();
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      if (posts.length === 1) {
        return Response.json(
          { error: "A channel with that name already exists" },
          { status: 409 }
        );
      }
      return Response.json({ channel: { id: "new-room", name: "Updates" } });
    }
    return Response.json({
      channels: [{ channelType: "TEXT", id: "general", name: "general" }],
      permissions: { canManage },
    });
  };
  for (const [key, value] of Object.entries({
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    fetch: fetchMock,
    navigator: dom.navigator,
    window: dom,
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const { createRoot } = await import("react-dom/client");
  const { default: CommunityChannelShortcuts } =
    await import("./community-channel-shortcuts");
  const root = createRoot(host as unknown as HTMLElement);
  const memberClient = new QueryClient();
  const staffClient = new QueryClient();
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label
    );
  const render = async (client: QueryClient) => {
    await act(() =>
      root.render(
        <QueryClientProvider
          client={client}
          key={canManage ? "staff" : "member"}
        >
          <CommunityChannelShortcuts slug="table" />
        </QueryClientProvider>
      )
    );
    const deadline = Date.now() + 1000;
    while (
      !host.querySelector('a[href="/a/table/chat/general"]') &&
      Date.now() < deadline
    ) {
      // oxlint-disable-next-line no-await-in-loop -- Wait for the channel query's asynchronous render.
      await act(async () => {
        await Bun.sleep(10);
      });
    }
  };

  try {
    await render(memberClient);
    expect(
      host.querySelector('a[href="/a/table/chat/general"]')
    ).not.toBeNull();
    expect(button("Create chat")).toBeUndefined();

    canManage = true;
    await render(staffClient);
    await act(() => button("Create chat")?.click());
    const name = host.querySelector("input");
    expect(name).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(
      dom.HTMLInputElement.prototype,
      "value"
    )?.set;
    await act(() => {
      setValue?.call(name, "  Updates  ");
      name?.dispatchEvent(new dom.Event("input", { bubbles: true }));
      button("Announcement")?.click();
    });
    const submit = () =>
      act(() => {
        host
          .querySelector("form")
          ?.dispatchEvent(
            new dom.Event("submit", { bubbles: true, cancelable: true })
          );
      });
    await submit();
    expect(posts).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "A channel with that name already exists"
    );
    expect(push).not.toHaveBeenCalled();

    await submit();
    expect(posts).toEqual([
      { channelType: "ANNOUNCEMENT", name: "Updates" },
      { channelType: "ANNOUNCEMENT", name: "Updates" },
    ]);
    expect(push).toHaveBeenCalledWith("/a/table/chat/new-room", {
      scroll: false,
    });
  } finally {
    await act(() => root.unmount());
    memberClient.clear();
    staffClient.clear();
    await dom.happyDOM.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  }
});
