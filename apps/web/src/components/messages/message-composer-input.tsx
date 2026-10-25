"use client";

import { useLayoutEffect } from "react";
import type { ComponentProps, RefObject } from "react";

type MessageComposerInputProps = Pick<
  ComponentProps<"textarea">,
  "disabled" | "onChange" | "onKeyDown" | "onPaste"
> & {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  value: string;
};

export function MessageComposerInput({
  inputRef,
  placeholder,
  value,
  ...props
}: MessageComposerInputProps) {
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }
    const resize = () => {
      textarea.style.height = "0px";
      const height = Math.max(40, Math.min(textarea.scrollHeight, 136));
      textarea.style.height = `${height}px`;
      textarea.style.overflowY =
        textarea.scrollHeight > height ? "auto" : "hidden";
    };
    resize();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== width) {
        width = textarea.clientWidth;
        resize();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Draft changes require a height measurement before paint.
  }, [inputRef, value]);

  return (
    <div className="relative mx-2 min-w-0 flex-1 text-base leading-6 sm:text-sm sm:leading-6">
      {!value && (
        <span
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none absolute inset-x-0 top-2 block truncate"
        >
          {placeholder}
        </span>
      )}
      <textarea
        {...props}
        aria-label="Message"
        aria-placeholder={placeholder}
        className="block max-h-34 min-h-10 w-full resize-none border-0 bg-transparent px-0 py-2 leading-6 text-inherit outline-none disabled:opacity-60"
        ref={inputRef}
        rows={1}
        value={value}
      />
    </div>
  );
}
