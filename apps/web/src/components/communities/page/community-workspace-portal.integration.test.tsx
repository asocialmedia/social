import { afterEach, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import {
  communitySectionScope,
  useCommunitySectionStore,
} from "@/store/community-section-store";

import { CommunityWorkspacePortalContext } from "./community-workspace-context";
import CommunityWorkspaceNavigation from "./community-workspace-navigation";

mock.module("@/components/layouts/navigation/mobile/mobile-bottom-nav", () => ({
  default: () => <nav aria-label="Primary">App navigation</nav>,
}));

const originals = new Map<string, PropertyDescriptor | undefined>();
let root: Root | undefined;
let dom: Window | undefined;

afterEach(async () => {
  if (root) {
    await act(() => root?.unmount());
  }
  await act(async () => {
    await dom?.happyDOM.close();
  });
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  originals.clear();
  useCommunitySectionStore.setState({ locations: {} });
  root = undefined;
  dom = undefined;
});

test("community drawer stays inside its portal host and dismisses through its close control", async () => {
  dom = new Window({ url: "http://localhost:3000/a/table" });
  const bindings = {
    CustomEvent: dom.CustomEvent,
    Element: dom.Element,
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.MutationObserver,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    document: dom.document,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    navigator: dom.navigator,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    window: dom,
  };
  for (const [key, value] of Object.entries(bindings)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  const appNavigation = dom.document.createElement("aside");
  appNavigation.id = "root-navigation";
  const workspace = dom.document.createElement("main");
  dom.document.body.append(appNavigation, workspace);
  const host = workspace as unknown as HTMLDivElement;
  const triggerRef = createRef<HTMLButtonElement>();
  useCommunitySectionStore
    .getState()
    .remember(communitySectionScope(undefined, "table"), {
      chatHref: "/a/table/chat/studio",
      postsHref: "/a/table?sort=top",
    });
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <CommunityWorkspacePortalContext.Provider value={host}>
        <button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
          Open community
        </button>
        <CommunityWorkspaceNavigation
          active="posts"
          accentColor="forest"
          avatarUrl={null}
          communityName="The Open Table"
          desktop={false}
          navigation={<span>General</span>}
          open={open}
          onOpenChange={setOpen}
          slug="table"
          triggerRef={triggerRef}
        />
      </CommunityWorkspacePortalContext.Provider>
    );
  }
  root = createRoot(host);
  await act(() => root?.render(<Harness />));
  await act(async () => {
    await Bun.sleep(10);
  });
  const dialog = workspace.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(workspace.contains(dialog)).toBe(true);
  expect(appNavigation.querySelector('[role="dialog"]')).toBeNull();
  expect(dialog?.classList.contains("absolute")).toBe(true);
  expect(dialog?.classList.contains("fixed")).toBe(false);
  const backdrop = workspace.querySelector('[class*="bg-black/35"]');
  expect(backdrop?.classList.contains("absolute")).toBe(true);
  expect(dialog?.querySelector('[aria-label="Primary"]')).not.toBeNull();
  expect(Boolean(dialog?.querySelector('a[href="/a/table?sort=top"]'))).toBe(
    true
  );
  expect(Boolean(dialog?.querySelector('a[href="/a/table/chat/studio"]'))).toBe(
    true
  );
  const close = dialog?.querySelector('button[aria-label="Close"]');
  expect(close).not.toBeNull();
  await act(() => {
    close?.dispatchEvent(new bindings.Event("click", { bubbles: true }));
  });
  expect(dialog?.dataset.state).toBe("closed");
});
