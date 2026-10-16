import { profileMutualLabel } from "@asm/ui/lib/profile-mutuals";
import type { UserListMutual } from "@asm/ui/lib/user-list";

import UserAvatar from "@/components/layouts/user/user-avatar";

export function ProfileMutualAvatars({
  kind,
  users,
  total,
}: {
  kind: "followers" | "following";
  users: readonly UserListMutual[] | undefined;
  total?: number;
}) {
  const visible = users?.slice(0, 3) ?? [];
  if (!visible.length) {
    return null;
  }
  const count = total ?? users?.length ?? 0;
  const remaining = Math.max(0, count - visible.length);
  const label = profileMutualLabel(kind, visible, count);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      data-profile-mutuals={kind}
      title={label}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className="flex -space-x-2">
        {visible.map((user, index) => (
          <span
            aria-hidden
            className="ring-background rounded-md ring-1"
            key={user.id}
            style={{ zIndex: visible.length - index }}
          >
            <UserAvatar
              avatarUrl={user.avatarUrl}
              className="rounded-md!"
              seed={user.id}
              size={20}
            />
          </span>
        ))}
      </span>
      {remaining ? (
        <span
          aria-hidden
          className="text-muted-foreground text-xs tabular-nums"
        >
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}
