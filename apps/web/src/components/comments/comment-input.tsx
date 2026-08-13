import type { PostData, UserData } from "@asm/db";
import { Input } from "@asm/ui/shadui/input";
import { useQuery } from "@tanstack/react-query";
import { Loader2, SendHorizonal } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user-avatar";
import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";
import { useSubmitCommentMutation } from "./mutations";

const SEND_BTN_SHADOW =
  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]";

interface CommentInputProps {
  post: PostData;
}

export default function CommentInput({ post }: CommentInputProps) {
  const { user } = useSession();
  const [input, setInput] = useState("");

  const mutation = useSubmitCommentMutation(post.id);

  const { data: userData } = useQuery({
    queryKey: ["user", user.id],
    queryFn: () => kyInstance.get(`/api/users/${user.id}`).json<UserData>(),
    staleTime: 1000 * 60 * 5,
  });

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInput(e.target.value);
    },
    []
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!input) {
      return;
    }

    mutation.mutate(
      {
        post,
        content: input,
      },
      {
        onSuccess: () => setInput(""),
      }
    );
  }

  return (
    <form
      className="my-3 hidden w-full items-center gap-2 lg:flex"
      onSubmit={onSubmit}
    >
      <UserAvatar
        avatarUrl={userData?.avatarUrl || user.image}
        className="h-10 w-10 shrink-0"
      />
      <Input
        autoFocus
        onChange={handleInputChange}
        placeholder="Add your Eddie to the flow..."
        value={input}
      />
      <button
        aria-label="Send eddy"
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-[#ff9500] to-[#e65500] text-white transition-all duration-200 hover:brightness-110 active:translate-y-px",
          SEND_BTN_SHADOW,
          (!input.trim() || mutation.isPending) && "opacity-50"
        )}
        disabled={!input.trim() || mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <SendHorizonal className="size-5" />
        )}
      </button>
    </form>
  );
}
