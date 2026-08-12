import type { UserData } from "@asm/db";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import Image from "next/image";
import { cn, supportsTransparency } from "@/lib/utils";

interface UserAvatarProps {
  avatarUrl?: string | null;
  className?: string;
  priority?: boolean;
  size?: number;
  user?: Pick<UserData, "avatarUrl"> | null;
}

export default function UserAvatar({
  user,
  avatarUrl: directAvatarUrl,
  size,
  className,
  priority = false,
}: UserAvatarProps) {
  const avatarUrl = user?.avatarUrl ?? directAvatarUrl;
  const resolvedSrc =
    typeof avatarUrl === "string" ? avatarUrl : avatarPlaceholder.src;
  const transparent = supportsTransparency(resolvedSrc);

  return (
    <Image
      alt="User avatar"
      className={cn(
        "aspect-square h-fit flex-none rounded-xl",
        "bg-gradient-to-b from-[hsl(var(--muted))] to-[hsl(var(--background-alt))]",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_2px_rgba(255,255,255,0.1),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.35),0_2px_4px_rgba(0,0,0,0.12)]",
        transparent ? "object-contain" : "object-cover",
        className
      )}
      height={size ?? 48}
      priority={priority}
      src={resolvedSrc}
      unoptimized={avatarUrl?.endsWith(".gif")}
      width={size ?? 48} // Don't optimize GIFs to keep animation
    />
  );
}
