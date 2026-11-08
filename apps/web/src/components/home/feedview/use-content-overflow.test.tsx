// oxlint-disable eslint/max-classes-per-file, eslint/class-methods-use-this, promise/prefer-await-to-callbacks -- Browser observer mocks need instance methods and callback constructors.
import { afterAll, expect, mock, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";

import { useContentOverflow } from "./use-content-overflow";

const dom = new Window();
let enter = () => {};
let leave = () => {};
let resize = () => {};
let observingSize = false;
let clipped = true;
let reads = 0;
const disconnectVisibility = mock();
const disconnectResize = mock();
class VisibilityObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    enter = () => callback([{ isIntersecting: true }]);
    leave = () => callback([{ isIntersecting: false }]);
  }
  observe(element: HTMLElement) {
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: {
        configurable: true,
        get: () => {
          reads += 1;
          return clipped ? 200 : 100;
        },
      },
    });
  }
  disconnect = disconnectVisibility;
}
class SizeObserver {
  constructor(callback: () => void) {
    resize = () => {
      if (observingSize) {
        return callback();
      }
    };
  }
  observe() {
    observingSize = true;
  }
  disconnect() {
    observingSize = false;
    disconnectResize();
  }
}
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  IntersectionObserver: VisibilityObserver,
  ResizeObserver: SizeObserver,
  document: dom.document,
  window: dom,
})) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [name, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
});

function Probe({ expanded, content }: { expanded: boolean; content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const overflowing = useContentOverflow(ref, expanded, content);
  return (
    <div ref={ref} data-overflowing={overflowing}>
      {content}
    </div>
  );
}

test("deferred cards measure near view, update on resize and recheck collapsed content", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  try {
    await act(() =>
      root.render(<Probe expanded={false} content="First post" />)
    );
    expect(reads).toBe(0);
    await act(enter);
    expect(host.firstElementChild?.dataset.overflowing).toBe("true");
    const visibleReads = reads;
    await act(leave);
    clipped = false;
    await act(resize);
    expect(reads).toBe(visibleReads);
    await act(enter);
    expect(host.firstElementChild?.dataset.overflowing).toBe("false");
    const previousReads = reads;
    await act(() => root.render(<Probe expanded content="First post" />));
    expect(reads).toBe(previousReads);
    clipped = true;
    await act(() =>
      root.render(<Probe expanded={false} content="Changed post" />)
    );
    expect(reads).toBe(previousReads);
    await act(enter);
    expect(host.firstElementChild?.dataset.overflowing).toBe("true");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
  expect(disconnectVisibility).toHaveBeenCalled();
  expect(disconnectResize).toHaveBeenCalled();
});
