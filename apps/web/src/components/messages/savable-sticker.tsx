"use client";
// oxlint-disable react/todo -- The compiler cannot lower the guarded save request and finalizer.

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@asm/ui/shadui/dialog";
import Image from "next/image";
import { useEffect, useState } from "react";

import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import { toast } from "@/lib/gooey-toast";

export function SavableSticker({
  url,
  mediaId,
  messageId,
  source = "messages",
  canSave = true,
}: {
  url: string;
  mediaId: string;
  messageId: string;
  source?: "messages" | "community";
  canSave?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState<{ id: string; favorite: boolean } | null>(
    null
  );
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || !canSave) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    const query = new URLSearchParams({
      mediaId,
      messageId,
      refresh: String(retry),
      source,
    });
    const load = async () => {
      try {
        const result = await request<{
          item: { id: string; favorite: boolean } | null;
        }>(`/api/stickers/membership?${query}`, { signal: controller.signal });
        if (active) {
          setItem(result.item);
          setLoaded(true);
        }
      } catch {
        if (active) {
          setLoadError(true);
        }
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, canSave, mediaId, messageId, source, retry]);

  const update = async (action: "library" | "favorite") => {
    if (busy || !loaded) {
      return;
    }
    setBusy(true);
    try {
      let current = item;
      if (action === "library" && current) {
        await request(`/api/stickers/${encodeURIComponent(current.id)}`, {
          method: "DELETE",
        });
        setItem(null);
      } else {
        if (!current) {
          const result = await request<{
            item: { id: string; favorite: boolean };
          }>("/api/stickers/save", {
            body: { mediaId, messageId, source },
            method: "POST",
          });
          current = result.item;
          setItem(current);
          notifyLibrary();
        }
        if (action === "favorite") {
          const favorite = !current.favorite;
          await request(`/api/stickers/${encodeURIComponent(current.id)}`, {
            body: { favorite },
            method: "PATCH",
          });
          setItem({ ...current, favorite });
        }
      }
      notifyLibrary();
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Please try again.",
        title: "Sticker wasn't updated",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setLoaded(false);
        setLoadError(false);
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <button
          aria-label="View sticker"
          className="focus-visible:outline-primary flex h-48 w-48 max-w-[80vw] items-center justify-center rounded-xl focus-visible:outline-2"
          type="button"
        >
          <Image
            alt="Sticker"
            className="max-h-full max-w-full object-contain"
            draggable={false}
            height={192}
            src={url}
            unoptimized
            width={192}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Sticker</DialogTitle>
        </DialogHeader>
        <Image
          alt="Sticker preview"
          className="mx-auto h-64 w-64 object-contain"
          height={256}
          src={url}
          unoptimized
          width={256}
        />
        {canSave ? (
          <div className="flex flex-col gap-2" aria-busy={busy}>
            {loadError ? (
              <Button
                className="min-h-12"
                onClick={() => {
                  setLoaded(false);
                  setLoadError(false);
                  setRetry((value) => value + 1);
                }}
              >
                Retry sticker actions
              </Button>
            ) : null}
            {!loadError && !loaded ? (
              <output className="text-muted-foreground py-3 text-center text-sm">
                <ZephLoader variant="media" className="mr-2 size-6" />
                Loading sticker actions…
              </output>
            ) : null}
            {!loadError && loaded ? (
              <>
                <Button
                  className="min-h-12"
                  disabled={busy}
                  onClick={() => update("library")}
                  variant={item ? "outline" : "default"}
                >
                  {item ? "Remove from My stickers" : "Add to My stickers"}
                </Button>
                <Button
                  className="min-h-12"
                  variant="outline"
                  disabled={busy}
                  onClick={() => update("favorite")}
                >
                  {item?.favorite
                    ? "Remove from favorites"
                    : "Add to favorites"}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

async function request<T>(
  url: string,
  options: {
    method?: "DELETE" | "PATCH" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "Please try again."
    );
  }
  return body;
}
function notifyLibrary() {
  window.dispatchEvent(new Event("sticker-library-updated"));
}
