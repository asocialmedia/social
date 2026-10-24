"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Check, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export interface LanguageOption {
  code: string;
  name: string;
}

// Generate canonical ISO-639-1 languages with English display names.
function buildLanguageList(): LanguageOption[] {
  const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
  const options: LanguageOption[] = [];
  for (let i = 97; i <= 122; i += 1) {
    for (let j = 97; j <= 122; j += 1) {
      const code = String.fromCodePoint(i, j);
      try {
        const name = displayNames.of(code);
        if (
          name &&
          name !== code &&
          !name.includes("(") &&
          !/^[a-z]{2}$/i.test(name)
        ) {
          options.push({ code, name });
        }
      } catch {
        // Ignore unsupported codes
      }
    }
  }
  return options.toSorted((a, b) => a.name.localeCompare(b.name));
}

const ALL_LANGUAGES: LanguageOption[] = buildLanguageList();

const POPULAR_CODES = ["en", "ja", "pt", "de"];

interface ContentLanguagesDialogProps {
  onOpenChange: (open: boolean) => void;
  onSelectLanguages: (languages: string[]) => void;
  open: boolean;
  selectedLanguages: string[];
}

export function ContentLanguagesDialog({
  onOpenChange,
  onSelectLanguages,
  open,
  selectedLanguages,
}: ContentLanguagesDialogProps) {
  const [search, setSearch] = useState("");
  const inputId = useId();

  const toggleLanguage = (code: string) => {
    const isSelected = selectedLanguages.includes(code);
    const next = isSelected
      ? selectedLanguages.filter((item) => item !== code)
      : [...selectedLanguages, code];
    onSelectLanguages(next);
  };

  const filteredLanguages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return ALL_LANGUAGES;
    }
    return ALL_LANGUAGES.filter(
      (lang) =>
        lang.name.toLowerCase().includes(query) ||
        lang.code.toLowerCase().includes(query)
    );
  }, [search]);

  // Recently used section contains standard popular languages and any user-selected languages
  const recentlyUsedLanguages = useMemo(() => {
    const combinedCodes = [
      ...new Set([...selectedLanguages, ...POPULAR_CODES]),
    ];
    return combinedCodes
      .map((code) => {
        const found = ALL_LANGUAGES.find((lang) => lang.code === code);
        if (found) {
          return found;
        }
        try {
          const name = new Intl.DisplayNames(["en"], {
            type: "language",
          }).of(code);
          return name ? { code, name } : null;
        } catch {
          return null;
        }
      })
      .filter((item): item is LanguageOption => item !== null)
      .filter((lang) => {
        if (!search.trim()) {
          return true;
        }
        const query = search.trim().toLowerCase();
        return (
          lang.name.toLowerCase().includes(query) ||
          lang.code.toLowerCase().includes(query)
        );
      });
  }, [selectedLanguages, search]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="text-foreground text-lg font-bold tracking-tight">
            Select content languages
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs leading-normal">
            If none are selected, all languages will be shown in your feeds
          </DialogDescription>
        </DialogHeader>

        {/* Search Input */}
        <div className="border-border/60 border-b px-4 py-3">
          <div className="surface-3d relative flex items-center rounded-xl px-3 py-2">
            <Search className="text-muted-foreground mr-2.5 size-4 shrink-0" />
            <label className="sr-only" htmlFor={inputId}>
              Search languages
            </label>
            <input
              autoComplete="off"
              className="placeholder:text-muted-foreground text-foreground w-full bg-transparent text-sm outline-none"
              id={inputId}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search languages"
              type="text"
              value={search}
            />
            {search ? (
              <button
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground ml-2 flex size-5 cursor-pointer items-center justify-center rounded-full"
                onClick={() => setSearch("")}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Language Lists */}
        <div className="max-h-[55vh] flex-1 overflow-y-auto px-2 py-3">
          {/* Recently Used Section */}
          {recentlyUsedLanguages.length > 0 ? (
            <div className="mb-4">
              <h3 className="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                Recently used
              </h3>
              <div className="space-y-0.5">
                {recentlyUsedLanguages.map((lang) => {
                  const isChecked = selectedLanguages.includes(lang.code);
                  return (
                    <button
                      key={`recent-${lang.code}`}
                      aria-pressed={isChecked}
                      className={cn(
                        "pill-3d-hover flex w-full cursor-pointer items-center justify-between rounded-lg border-0 px-3 py-2.5 text-left",
                        isChecked && "text-foreground font-medium"
                      )}
                      onClick={() => toggleLanguage(lang.code)}
                      type="button"
                    >
                      <span className="text-sm">{lang.name}</span>
                      {isChecked ? (
                        <Check className="text-primary size-4 shrink-0 stroke-[2.5]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* All Languages Section */}
          <div>
            <h3 className="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
              All languages
            </h3>
            {filteredLanguages.length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                No languages found
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredLanguages.map((lang) => {
                  const isChecked = selectedLanguages.includes(lang.code);
                  return (
                    <button
                      key={`all-${lang.code}`}
                      aria-pressed={isChecked}
                      className={cn(
                        "pill-3d-hover flex w-full cursor-pointer items-center justify-between rounded-lg border-0 px-3 py-2.5 text-left",
                        isChecked && "text-foreground font-medium"
                      )}
                      onClick={() => toggleLanguage(lang.code)}
                      type="button"
                    >
                      <span className="text-sm">{lang.name}</span>
                      {isChecked ? (
                        <Check className="text-primary size-4 shrink-0 stroke-[2.5]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
