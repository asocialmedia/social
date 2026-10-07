"use client";

import messagesImage from "@assets/general/messages.png";
import { Users } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ActiveFriendsRail } from "@/components/messages/active-friends-rail";
import { ConversationList } from "@/components/messages/conversation-list";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { MessageIdentityLocked } from "@/components/messages/message-identity-recovery";
import { MessageThread } from "@/components/messages/message-thread";
import { MessagesSkeleton } from "@/components/messages/messages-skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import { conversationListLayout } from "@/lib/messages/conversation-list-layout";
import { cn } from "@/lib/utils";
import { useMessagesSidebarStore } from "@/store/messages-sidebar-store";

export default function ClientMessages() {
  const { status, reset } = useMessagesIdentity();
  const { isCollapsed, setCollapsed, toggleCollapsed } =
    useMessagesSidebarStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("c");
  const dmUserId = searchParams.get("dm");
  const [railOpen, setRailOpen] = useState(false);
  // Whether the window is wide enough for two panes. `48rem` tracks Tailwind's `md`
  // exactly; below it the list and the conversation are the same surface shown one
  // at a time, which is what the thread's back button swaps.
  //
  // A media query rather than a CSS class because the choice is about what is
  // MOUNTED, not just what is painted: a hidden-but-mounted list would keep its
  // query polling and its preview decrypts running for a pane nobody can see.
  const desktopList = useMediaQuery("(min-width: 48rem)");
  const keyboardInset = useAppScreenLayout();

  // The identity is provisioned automatically by the provider, so the
  // conversation the user was trying to reach just works once ready.
  const pendingConversation = conversationId;

  // Deep-link from a profile's Message button: ?dm=<userId> starts a
  // create-or-find conversation with that user. The ConversationList owns that
  // flow (it listens for the same event the online-friends rail uses), so it's
  // only fired once the list is mounted and identity is ready, then the param
  // is cleared to avoid re-triggering.
  useEffect(() => {
    if (!dmUserId || status !== "ready") {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dm");
    const query = params.toString();
    router.replace(query ? `/messages?${query}` : "/messages", {
      scroll: false,
    });
    window.dispatchEvent(
      new CustomEvent("messages:new-conversation", {
        detail: { userId: dmUserId },
      })
    );
  }, [dmUserId, router, searchParams, status]);

  const selectConversation = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set("c", id);
      } else {
        params.delete("c");
      }
      router.replace(`/messages?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  if (status === "loading") {
    return (
      <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
        <MessagesSkeleton />
      </div>
    );
  }

  if (status === "locked") {
    return <MessageIdentityLocked onReset={reset} />;
  }

  if (status === "error") {
    return (
      <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Messages couldn't be set up. Reload to try again.
          </p>
        </div>
      </div>
    );
  }

  const listLayout = conversationListLayout({
    collapsed: isCollapsed,
    conversationOpen: Boolean(pendingConversation),
    desktopViewport: desktopList,
  });

  return (
    <div
      className={cn(
        "border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x lg:pb-0",
        // The bottom nav only shows when no thread is open (it unmounts for
        // an active chat), so the padding reserved for it must too.
        pendingConversation ? "" : "pb-14"
      )}
    >
      <div
        className="hide-native-scrollbar flex min-h-0 flex-1 flex-row overflow-hidden"
        // Lift everything above the on-screen keyboard: the software keyboard
        // overlays the layout viewport, so pad by its height to keep the
        // composer visible without the browser panning the page.
        style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
      >
        <ConversationList
          activeConversationId={pendingConversation ?? null}
          isCollapsed={listLayout === "rail"}
          layout={listLayout}
          onExpand={() => setCollapsed(false)}
          onSelect={selectConversation}
          onToggleCollapse={toggleCollapsed}
        />

        {/* On a phone with a conversation open this is the whole screen; with none
            open the list above is, so the empty state and its header stand down. */}
        <div
          className={cn(
            "min-w-0 flex-1 flex-col border-r border-[hsl(var(--border))]",
            listLayout === "full" && !desktopList ? "hidden" : "flex"
          )}
        >
          {pendingConversation ? (
            <MessageThread
              conversationId={pendingConversation}
              key={pendingConversation}
              onBack={() => selectConversation(null)}
              onToggleRail={() => setRailOpen((open) => !open)}
            />
          ) : (
            <>
              {/* Keep the header line continuous when no thread is open. */}
              <div className="border-border/60 flex h-14 shrink-0 items-center justify-end border-b px-4">
                <button
                  aria-label="Online friends"
                  className="icon-btn-3d flex h-8 w-8 items-center justify-center rounded-full lg:hidden"
                  onClick={() => setRailOpen((open) => !open)}
                  type="button"
                >
                  <Users className="h-4 w-4" />
                </button>
              </div>
              <EmptyThreadState />
            </>
          )}
        </div>

        <ActiveFriendsRail
          // With a thread open the details pane takes the right-hand slot on
          // wide screens, so the online list yields it there and only there --
          // the drawer below `lg` is untouched, which is why this is a separate
          // prop rather than `open`.
          desktopSuperseded={Boolean(pendingConversation)}
          onClose={() => setRailOpen(false)}
          onSelect={(userId) => {
            // Clicking an online friend opens a fresh conversation with them;
            // the conversation list search handles the create-or-find flow.
            setRailOpen(false);
            selectConversation(null);
            window.dispatchEvent(
              new CustomEvent("messages:new-conversation", {
                detail: { userId },
              })
            );
          }}
          open={railOpen}
        />
      </div>
    </div>
  );
}

// Messages behaves like an app screen: the document itself never scrolls
// (only the transcript and conversation list scroll internally), and the
// software keyboard must not push the page around. Locking html/body scroll
// stops mobile browsers from panning the whole app past its bounds when the
// composer is focused, and the visualViewport listener exposes how much the
// keyboard covers so the layout can shrink above it (dvh ignores the
// keyboard). Same offset trick as the floating post editor.
function useAppScreenLayout() {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const { body, documentElement } = document;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    documentElement.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const viewport = window.visualViewport;
    if (!viewport) {
      return () => {
        documentElement.style.overflow = previousHtmlOverflow;
        body.style.overflow = previousBodyOverflow;
      };
    }

    const syncViewport = () => {
      // Undo any pan the browser applied to the window while chasing the
      // focused input; the keyboard inset keeps that input visible, so no
      // pan is needed in the first place.
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      setKeyboardInset(Math.max(0, window.innerHeight - viewport.height));
    };
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    syncViewport();

    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      documentElement.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, []);

  return keyboardInset;
}

function EmptyThreadState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 p-8 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain opacity-90"
          draggable={false}
          height={1254}
          src={messagesImage}
          width={1254}
        />
        <h2 className="text-lg font-semibold">Your messages</h2>
        <p className="text-muted-foreground max-w-64 text-sm">
          Pick a conversation on the left, or start a new one by searching for
          someone you follow.
        </p>
      </div>
    </div>
  );
}
