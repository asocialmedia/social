"use client";

import { X } from "lucide-react";

// A chosen item — an interest, an avoided topic, a language. One shape
// everywhere, so a selected thing looks the same across all three Network
// panels.
//
// The cross is collapsed to zero width at rest and expands on hover or focus, so
// the pill is only as wide as its label until you reach for the control. That
// keeps a row of short labels from reading as a row of gaps, and it keeps the
// control in the DOM for keyboard and touch where there is no hover.
export function SettingsPill({
  disabled,
  label,
  onRemove,
}: {
  disabled?: boolean;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="chip-3d-raised group/pill inline-flex items-center rounded-lg py-1.5 pr-2.5 pl-3 text-sm font-medium transition-[padding] group-hover/pill:pr-1.5">
      {label}
      <button
        aria-label={`Remove ${label}`}
        className="focus-visible:ring-ring ml-0 flex w-0 items-center justify-center overflow-hidden rounded-md opacity-0 transition-all group-hover/pill:ml-1 group-hover/pill:w-5 group-hover/pill:opacity-100 focus-visible:ml-1 focus-visible:w-5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-hidden disabled:opacity-40 max-md:ml-1 max-md:w-5 max-md:opacity-100"
        disabled={disabled}
        onClick={onRemove}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
