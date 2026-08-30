"use client";

import notFoundImage from "@assets/general/notfound.png";
import { Users, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef } from "react";

import UserAvatar from "@/components/layouts/user-avatar";
import type { PresenceUser } from "@/lib/messages/client";
import { usePresence } from "@/lib/messages/use-presence";
import { cn } from "@/lib/utils";

interface ActiveFriendsRailProps {
  onClose: () => void;
  onSelect: (userId: string) => void;
  open: boolean;
}

export function ActiveFriendsRail({
  onClose,
  onSelect,
  open,
}: ActiveFriendsRailProps) {
  const users = usePresence(true);
  const online = users.filter((user) => user.status === "online");
  const idle = users.filter((user) => user.status === "idle");
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Modal semantics for the mobile drawer: focus moves into it on open,
  // Escape closes it, and focus returns to the trigger on close.
  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    drawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [open, onClose]);

  const body =
    users.length === 0 ? (
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="flex w-full flex-col items-center gap-2 px-4 py-6 text-center">
          <Image
            alt=""
            className="h-24 w-auto object-contain opacity-85"
            draggable={false}
            height={1145}
            src={notFoundImage}
            width={1374}
          />
          <p className="text-muted-foreground text-xs leading-relaxed">
            None of the people you follow are online right now. Check back
            later.
          </p>
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {online.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {online.map((user) => (
              <PresenceRow
                key={user.id}
                onSelect={onSelect}
                status="online"
                user={user}
              />
            ))}
          </div>
        ) : null}
        {idle.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-muted-foreground/70 px-2 pt-1 text-[11px] font-medium tracking-wide uppercase">
              Idle
            </p>
            {idle.map((user) => (
              <PresenceRow
                key={user.id}
                onSelect={onSelect}
                status="idle"
                user={user}
              />
            ))}
          </div>
        ) : null}
      </div>
    );

  return (
    <>
      {/* Desktop rail: always visible on lg+. */}
      <aside className="hide-native-scrollbar bg-background border-border/60 hidden w-72 shrink-0 flex-col overflow-y-auto border-l lg:flex">
        <RailHeader onlineCount={online.length} />
        <div className="flex flex-1 flex-col px-4 py-4">{body}</div>
      </aside>

      {/* Mobile drawer: toggled by the header button, overlays the page. */}
      {open ? (
        <div className="fixed inset-0 z-60 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={onClose}
          />
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a styled drawer, not a native dialog; role + aria-modal give it dialog semantics without UA dialog positioning */}
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role */}
          <aside
            aria-label="Online friends"
            aria-modal="true"
            className="bg-background border-border/60 absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col border-l shadow-2xl"
            role="dialog"
          >
            {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
            <RailHeader
              closeRef={drawerCloseRef}
              onClose={onClose}
              onlineCount={online.length}
            />
            <div className="hide-native-scrollbar flex flex-1 flex-col overflow-y-auto px-4 py-4">
              {body}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function RailHeader({
  closeRef,
  onlineCount,
  onClose,
}: {
  closeRef?: React.Ref<HTMLButtonElement>;
  onlineCount: number;
  onClose?: () => void;
}) {
  return (
    <div className="border-border/60 flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <Users className="text-muted-foreground h-4 w-4" />
      <h3 className="text-sm font-semibold">Online</h3>
      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
        {onlineCount}
      </span>
      {onClose ? (
        <button
          aria-label="Close online friends"
          className="icon-btn-3d ml-1 flex h-8 w-8 items-center justify-center rounded-full"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function PresenceRow({
  onSelect,
  status,
  user,
}: {
  onSelect: (userId: string) => void;
  status: "idle" | "online";
  user: PresenceUser;
}) {
  return (
    <button
      className="pill-3d-hover flex items-center gap-2.5 rounded-xl px-2 py-2 text-left"
      onClick={() => onSelect(user.id)}
      type="button"
    >
      <div className="relative shrink-0">
        <UserAvatar avatarUrl={user.avatarUrl} size={36} />
        <span
          className={cn(
            "border-background absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2",
            status === "online" ? "bg-green-500" : "bg-amber-500"
          )}
        />
      </div>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {user.displayName}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          @{user.username}
        </span>
      </span>
    </button>
  );
}
