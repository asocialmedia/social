// oxlint-disable react/todo -- The compiler cannot lower the guarded save request and finalizer.
import { useEffect, useState } from "react";
import { DeviceEventEmitter, Modal, Pressable, Text, View } from "react-native";

import { toast } from "@/components/feedback/toast";
import { apiJson } from "@/features/media-upload/lib/upload-api";
import { panel3d } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

export function SavableSticker({
  children,
  mediaId,
  messageId,
  canSave,
  source = "messages",
}: {
  children: React.ReactNode;
  mediaId: string;
  messageId: string;
  canSave: boolean;
  source?: "messages" | "community";
}) {
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
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
        const result = await apiJson<{
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
        await apiJson(`/api/stickers/${encodeURIComponent(current.id)}`, {
          method: "DELETE",
        });
        setItem(null);
      } else {
        if (!current) {
          const result = await apiJson<{
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
          await apiJson(`/api/stickers/${encodeURIComponent(current.id)}`, {
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
    <>
      <Pressable
        accessibilityLabel="View sticker"
        accessibilityRole="button"
        onPress={() => {
          setLoaded(false);
          setLoadError(false);
          setOpen(true);
        }}
      >
        {children}
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <View
          style={{
            alignItems: "center",
            backgroundColor: "#000b",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <View
            style={{
              alignItems: "center",
              backgroundColor: panel.background,
              borderColor: panel.border,
              borderRadius: 20,
              borderWidth: 1,
              boxShadow: panel.shadows,
              gap: 16,
              padding: 24,
            }}
          >
            {children}
            {canSave ? (
              <View style={{ alignSelf: "stretch", gap: 8 }}>
                {loadError ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setLoaded(false);
                      setLoadError(false);
                      setRetry((value) => value + 1);
                    }}
                    style={{ minHeight: 52, padding: 16 }}
                  >
                    <Text style={{ color: theme.inputText }}>
                      Retry sticker actions
                    </Text>
                  </Pressable>
                ) : null}
                {!loadError && !loaded ? (
                  <Text style={{ color: theme.inputText }}>
                    Loading sticker actions…
                  </Text>
                ) : null}
                {!loadError && loaded ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => update("library")}
                      style={{
                        minHeight: 52,
                        opacity: busy ? 0.5 : 1,
                        padding: 16,
                      }}
                    >
                      <Text style={{ color: theme.inputText }}>
                        {item
                          ? "Remove from My stickers"
                          : "Add to My stickers"}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => update("favorite")}
                      style={{
                        minHeight: 52,
                        opacity: busy ? 0.5 : 1,
                        padding: 16,
                      }}
                    >
                      <Text style={{ color: theme.inputText }}>
                        {item?.favorite
                          ? "Remove from favorites"
                          : "Add to favorites"}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={{ minHeight: 48, padding: 12 }}
            >
              <Text style={{ color: theme.inputText }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function notifyLibrary() {
  DeviceEventEmitter.emit("sticker-library-updated");
}
