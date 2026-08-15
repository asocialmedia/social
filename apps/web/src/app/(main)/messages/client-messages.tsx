"use client";

import noMessageImage from "@assets/general/nomessage.png";
import { Users } from "lucide-react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { ActiveFriendsRail } from "@/components/messages/active-friends-rail";
import { ConversationList } from "@/components/messages/conversation-list";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { MessageThread } from "@/components/messages/message-thread";
import { MessagesSkeleton } from "@/components/messages/messages-skeleton";

export default function ClientMessages() {
  const { status } = useMessagesIdentity();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("c");
  const [railOpen, setRailOpen] = useState(false);

  // The identity is provisioned automatically by the provider, so the
  // conversation the user was trying to reach just works once ready.
  const pendingConversation = conversationId;

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

  return (
    <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] pb-14 sm:border-x lg:pb-0">
      <div className="hide-native-scrollbar flex min-h-0 flex-1 flex-row overflow-hidden">
        <ConversationList
          activeConversationId={pendingConversation ?? null}
          onSelect={selectConversation}
        />

        <div className="flex min-w-0 flex-1 flex-col border-r border-[hsl(var(--border))]">
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

function EmptyThreadState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 p-8 text-center">
        <Image
          alt=""
          className="h-40 w-auto object-contain opacity-90"
          draggable={false}
          height={1024}
          src={noMessageImage}
          width={1536}
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
