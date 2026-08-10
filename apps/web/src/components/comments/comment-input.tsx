import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Loader2, SendHorizonal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useSubmitCommentMutation } from "./mutations";

interface CommentInputProps {
  post: PostData;
}

export default function CommentInput({ post }: CommentInputProps) {
  const [input, setInput] = useState("");

  const mutation = useSubmitCommentMutation(post.id);

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
    <form className="flex w-full items-center gap-2" onSubmit={onSubmit}>
      <Input
        autoFocus
        onChange={(e) => setInput(e.target.value)}
        placeholder="Add your Eddie to the flow..."
        value={input}
      />
      <Button
        disabled={!input.trim() || mutation.isPending}
        size="icon"
        type="submit"
        variant="ghost"
      >
        {mutation.isPending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <SendHorizonal />
        )}
      </Button>
    </form>
  );
}
