import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

let currentUser: { id: string } | null = null;
const refresh = mock(() => {});
const goToLogin = mock(() => {});
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: currentUser }),
}));
mock.module("@/hooks/auth/use-require-auth", () => ({
  useRequireAuth: () => ({ goToLogin }),
}));
mock.module("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
mock.module("./community-posts-workspace", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
mock.module("@/components/layouts/navigation/mobile/mobile-bottom-nav", () => ({
  default: () => null,
}));
mock.module("@/components/layouts/navigation/mobile/mobile-top-bar", () => ({
  default: () => null,
}));

const community = {
  accentColor: "slate",
  avatarUrl: null,
  bannerUrl: null,
  description: "Public about information",
  id: "private",
  mature: false,
  memberCount: 1,
  name: "Private space",
  slug: "private",
  topics: ["technology"],
  type: "PRIVATE" as const,
};
let membership: { role: "PARTICIPANT"; status: "ACTIVE" | "PENDING" } | null =
  null;
let banned = false;
let failNextRequest = false;
let failPreview = false;
function preview() {
  return {
    community,
    membership,
    permissions: {
      banned,
      canModerate: false,
      canReadChat: membership?.status === "ACTIVE",
      canReadContent: membership?.status === "ACTIVE",
      canRequest: Boolean(currentUser) && !banned && !membership,
    },
  };
}
const originals = new Map<string, PropertyDescriptor | undefined>();
const fetchOriginal = globalThis.fetch;
let dom: Window;
let client: QueryClient;
let root: Root | undefined;
const writes: { path: string; method: string }[] = [];

beforeAll(() => {
  dom = new Window({ url: "http://localhost/a/private" });
  for (const [key, value] of Object.entries({
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    navigator: dom.navigator,
    window: dom,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  client?.clear();
  dom.document.body.innerHTML = "";
  globalThis.fetch = fetchOriginal;
  currentUser = null;
  membership = null;
  banned = false;
  failNextRequest = false;
  failPreview = false;
  writes.length = 0;
  refresh.mockClear();
  goToLogin.mockClear();
});

afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  dom.happyDOM.abort();
});

async function settle() {
  await act(async () => {
    await Bun.sleep(20);
  });
}
function button(label: string) {
  const match = [...dom.document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label
  );
  if (!match) {
    throw new Error(`Missing button: ${label}`);
  }
  return match;
}
async function render() {
  const { default: CommunityPrivateLanding } =
    await import("./community-private-landing");
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  globalThis.fetch = mock(
    (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method) {
        writes.push({ method: init.method, path });
        if (failNextRequest) {
          failNextRequest = false;
          return Response.json(
            { error: "Couldn't send your request. Try again." },
            { status: 503 }
          );
        }
        membership =
          init.method === "DELETE"
            ? null
            : { role: "PARTICIPANT", status: "PENDING" };
      }
      if (!path.includes("/preview") && !path.includes("/membership")) {
        throw new Error("Locked page requested private contents");
      }
      if (path.includes("/preview") && failPreview) {
        return Response.json({ error: "Unavailable" }, { status: 503 });
      }
      return Response.json(preview());
    }
  ) as typeof fetch;
  root = createRoot(host);
  await act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <CommunityPrivateLanding
          initialPreview={preview()}
          viewerId={currentUser?.id ?? ""}
        />
      </QueryClientProvider>
    )
  );
  await settle();
}

test("guest sees a sign-in prompt without an about section or content navigation", async () => {
  await render();
  expect(dom.document.body.textContent).toContain(
    "Posts are for members of this community."
  );
  expect(dom.document.body.textContent).not.toContain(
    "Public about information"
  );
  expect(dom.document.querySelector("#community-public-about")).toBeNull();
  expect(dom.document.querySelector('a[href*="/chat"]')).toBeNull();
  await act(() => button("Sign in to request access").click());
  expect(goToLogin).toHaveBeenCalledTimes(1);
  expect(writes).toHaveLength(0);
});

test("applicant can request, see pending state, and cancel only the pending request", async () => {
  currentUser = { id: "applicant" };
  await render();
  await act(() => button("Request to join").click());
  await settle();
  expect(dom.document.body.textContent).toContain("Request pending");
  await act(() => button("Cancel request").click());
  await settle();
  expect(button("Request to join").disabled).toBe(false);
  expect(writes).toEqual([
    { method: "POST", path: "/api/communities/private/membership" },
    { method: "DELETE", path: "/api/communities/private/membership?pending=1" },
  ]);
});

test("approval revalidation refreshes the route to unlock the member experience", async () => {
  currentUser = { id: "applicant" };
  membership = { role: "PARTICIPANT", status: "PENDING" };
  await render();
  membership = { role: "PARTICIPANT", status: "ACTIVE" };
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["community-preview", "private", "applicant"],
    });
  });
  await settle();
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("banned viewers see the landing without a request control", async () => {
  currentUser = { id: "banned" };
  banned = true;
  await render();
  expect(dom.document.body.textContent).toContain("You cannot request access");
  expect(dom.document.querySelector("button")).toBeNull();
});

test("failed requests show an inline error and let the applicant try again", async () => {
  currentUser = { id: "applicant" };
  await render();
  failNextRequest = true;
  await act(() => button("Request to join").click());
  await settle();
  expect(dom.document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't send your request"
  );
  expect(button("Request to join").disabled).toBe(false);
  expect(dom.document.querySelector("output")).toBeNull();
  await act(() => button("Request to join").click());
  await settle();
  expect(dom.document.querySelector('[role="alert"]')).toBeNull();
  expect(dom.document.querySelector("output")?.textContent).toContain(
    "Request pending"
  );
});

test("membership refresh errors can be retried without reloading or submitting a request", async () => {
  currentUser = { id: "applicant" };
  failPreview = true;
  await render();
  expect(dom.document.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't refresh your membership"
  );
  failPreview = false;
  await act(() => button("Retry").click());
  await settle();
  expect(dom.document.querySelector('[role="alert"]')).toBeNull();
  expect(writes).toHaveLength(0);
  expect(refresh).not.toHaveBeenCalled();
});
