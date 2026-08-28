import { beforeEach, describe, expect, test } from "bun:test";

// The store reads window/sessionStorage at call time, so both globals must
// exist before it is imported (imports are hoisted; the dynamic import below
// runs after the stubs are in place).
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

Object.assign(globalThis, {
  sessionStorage: new MemoryStorage(),
  window: globalThis,
});

const STORAGE_KEY = "asm-composer-attachments";
const DRAFT_VERSION = 2;

const { useComposerAttachmentStore, __resetComposerAttachmentStoreForTests } =
  await import("./attachment-store");
const { useComposerStore } = await import("@/store/composer-store");

const gustVideoAttachment = {
  isUploading: false,
  mediaId: "media-1",
  name: "clip.mp4",
  progress: 100,
  type: "video/mp4",
};

function readRawDraft(): Record<string, unknown> {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function seedRawDraft(draft: Record<string, unknown>): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

async function flushMicrotasks(): Promise<void> {
  // One microtask tick is enough: the store defers its state set with a
  // single queueMicrotask, and awaiting a resolved promise yields exactly
  // that tick before the test continues.
  await Promise.resolve();
}

describe("composer attachment draft persistence", () => {
  beforeEach(() => {
    __resetComposerAttachmentStoreForTests();
    useComposerStore.setState({ isOpen: false, mode: "post" });
    sessionStorage.clear();
  });

  test("a gust draft persists with the composer mode it was authored in", () => {
    useComposerStore.getState().setMode("gust");
    useComposerAttachmentStore.setState({
      attachments: [gustVideoAttachment],
    });
    useComposerAttachmentStore
      .getState()
      .reorderAttachments([gustVideoAttachment]);

    const draft = readRawDraft();
    expect(draft.mode).toBe("gust");
    expect(draft.version).toBe(DRAFT_VERSION);
    expect((draft.items as unknown[]).length).toBe(1);
  });

  test("toggling the composer mode re-persists the draft under the new mode", () => {
    useComposerStore.getState().setMode("gust");
    useComposerAttachmentStore.setState({
      attachments: [gustVideoAttachment],
    });
    useComposerAttachmentStore
      .getState()
      .reorderAttachments([gustVideoAttachment]);
    expect(readRawDraft().mode).toBe("gust");

    useComposerStore.getState().setMode("post");
    expect(readRawDraft().mode).toBe("post");
  });

  test("an emptied draft persists no mode", () => {
    useComposerStore.getState().setMode("gust");
    useComposerAttachmentStore.getState().reorderAttachments([]);
    expect(readRawDraft().mode).toBeUndefined();
  });

  test("hydrate restores the draft and puts the composer back into its mode", async () => {
    seedRawDraft({
      items: [
        {
          mediaId: "media-1",
          name: "clip.mp4",
          type: "video/mp4",
        },
      ],
      mode: "gust",
      version: DRAFT_VERSION,
    });

    useComposerAttachmentStore.getState().hydrate();
    expect(useComposerStore.getState().mode).toBe("gust");

    await flushMicrotasks();
    const { attachments } = useComposerAttachmentStore.getState();
    expect(attachments.length).toBe(1);
    expect(attachments[0]?.mediaId).toBe("media-1");
    expect(attachments[0]?.mediaUrl).toBe("/api/media/media-1");
  });

  test("hydrate keeps the current mode when the stored draft carries none", () => {
    seedRawDraft({
      items: [
        {
          mediaId: "media-1",
          name: "photo.png",
          type: "image/png",
        },
      ],
      version: DRAFT_VERSION,
    });

    useComposerAttachmentStore.getState().hydrate();
    expect(useComposerStore.getState().mode).toBe("post");
  });

  test("drafts persisted by an older storage version are dropped", () => {
    seedRawDraft({
      items: [
        {
          mediaId: "media-1",
          name: "clip.mp4",
          type: "video/mp4",
        },
      ],
      version: 1,
    });

    useComposerAttachmentStore.getState().hydrate();
    expect(useComposerAttachmentStore.getState().attachments.length).toBe(0);
    expect(useComposerStore.getState().mode).toBe("post");
  });
});
