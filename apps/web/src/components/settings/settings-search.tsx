"use client";

import { Input } from "@asm/ui/shadui/input";
import noSearchImage from "@assets/general/nosearch.png";
import { Search, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type SettingsTab = "profile" | "account" | "security";

interface SettingsEntry {
  description: string;
  id: string;
  keywords: string[];
  label: string;
  sectionId: string;
  tab: SettingsTab;
}

const SETTINGS_CATALOG: SettingsEntry[] = [
  {
    description: "Change the name shown on your profile",
    id: "display-name",
    keywords: ["name", "displayname", "display name", "nickname", "handle"],
    label: "Display name",
    sectionId: "settings-profile",
    tab: "profile",
  },
  {
    description: "Edit your bio and about text",
    id: "bio",
    keywords: ["bio", "about", "description", "intro"],
    label: "Bio",
    sectionId: "settings-profile",
    tab: "profile",
  },
  {
    description: "Link your GitHub, X, LinkedIn and Reddit",
    id: "social-links",
    keywords: [
      "social",
      "links",
      "github",
      "twitter",
      "x",
      "linkedin",
      "reddit",
      "connect",
    ],
    label: "Social links",
    sectionId: "settings-profile",
    tab: "profile",
  },
  {
    description: "Change your @username handle",
    id: "username",
    keywords: ["username", "handle", "name", "@"],
    label: "Username",
    sectionId: "settings-username",
    tab: "account",
  },
  {
    description: "Update the email for your account",
    id: "email",
    keywords: ["email", "mail", "address", "inbox"],
    label: "Email address",
    sectionId: "settings-email",
    tab: "account",
  },
  {
    description: "Connect or disconnect Google and Reddit",
    id: "linked-accounts",
    keywords: [
      "linked",
      "accounts",
      "google",
      "reddit",
      "connect",
      "oauth",
      "link",
    ],
    label: "Linked accounts",
    sectionId: "settings-linked-accounts",
    tab: "account",
  },
  {
    description: "Reset your password via email",
    id: "password",
    keywords: [
      "password",
      "pass",
      "security",
      "reset",
      "login",
      "credential",
      "auth",
    ],
    label: "Change password",
    sectionId: "settings-password",
    tab: "security",
  },
];

const TAB_LABELS: Record<SettingsTab, string> = {
  account: "Account",
  profile: "Profile",
  security: "Security",
};

interface SettingsSearchProps {
  onNavigate: (tab: SettingsTab, sectionId?: string) => void;
}

export default function SettingsSearch({ onNavigate }: SettingsSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return SETTINGS_CATALOG.filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) ||
        entry.keywords.some((keyword) => keyword.includes(q))
    ).slice(0, 8);
  }, [query]);

  useEffect(() => {
    // eslint-disable-next-line react-compiler -- reset selection when the dialog mounts
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const select = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) {
        return;
      }
      close();
      onNavigate(result.tab, result.sectionId);
    },
    [close, onNavigate, results]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(activeIndex);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOpen(true);
  };

  const handleFocus = () => setOpen(true);

  const handleClear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  const handleSelectClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(e.currentTarget.dataset.index);
    select(index);
  };

  const handleRowMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(e.currentTarget.dataset.index);
    setActiveIndex(index);
  };

  const showPanel = open && results.length > 0;
  const showEmpty = open && Boolean(query.trim()) && results.length === 0;

  return (
    <div className="relative w-full" ref={rootRef}>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          aria-label="Search settings"
          autoComplete="off"
          className="premium-input h-9 rounded-xl pr-8 pl-9 text-sm"
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="Search settings"
          ref={inputRef}
          type="text"
          value={query}
        />
        {query ? (
          <button
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 transition-colors"
            onClick={handleClear}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <div className="apple-panel absolute top-full right-0 z-50 mt-2 w-[min(90vw,26rem)] overflow-hidden rounded-2xl p-1.5 shadow-none">
          <div className="flex flex-col gap-0.5">
            {results.map((result, index) => (
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all duration-200 ease-out outline-none",
                  index === activeIndex
                    ? "pill-nav-active"
                    : "pill-3d-hover text-foreground"
                )}
                data-index={index}
                key={result.id}
                onClick={handleSelectClick}
                onMouseEnter={handleRowMouseEnter}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{result.label}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {result.description}
                  </p>
                </div>
                <span className="border-border/60 bg-muted/50 text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                  {TAB_LABELS[result.tab]}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="apple-panel absolute top-full right-0 z-50 mt-2 w-[min(90vw,26rem)] rounded-2xl p-4 shadow-none">
          <div className="flex flex-col items-center justify-center gap-2 py-2 text-center">
            <Image
              alt=""
              className="h-20 w-auto object-contain"
              draggable={false}
              height={128}
              src={noSearchImage}
              width={128}
            />
            <p className="text-sm font-medium">No settings found</p>
            <p className="text-muted-foreground text-xs">
              Nothing matches &quot;{query}&quot;, try something else
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
