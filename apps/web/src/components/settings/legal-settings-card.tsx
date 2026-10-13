"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { ChevronRight, FileText, ShieldCheck, Scale } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { SettingsCard, SettingsCardHeading } from "./settings-section-card";

const TermsDocument = dynamic(() => import("@/app/(docs)/toc/client-toc"));
const PrivacyDocument = dynamic(
  () => import("@/app/(docs)/privacy/client-privacy")
);

const DOCUMENTS = [
  {
    description: "The rules for using asocialmedia",
    icon: FileText,
    path: "/toc",
    title: "Terms & Conditions",
  },
  {
    description: "How your data is collected and protected",
    icon: ShieldCheck,
    path: "/privacy",
    title: "Privacy Policy",
  },
] as const;

export function LegalSettingsCard() {
  const [document, setDocument] = useState<(typeof DOCUMENTS)[number] | null>(
    null
  );
  return (
    <>
      <SettingsCard id="settings-legal" className="space-y-4">
        <SettingsCardHeading
          icon={Scale}
          title="Legal"
          description="The Terms and Privacy Policy you accepted when you signed up."
        />
        {DOCUMENTS.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => setDocument(entry)}
            className="surface-3d focus-visible:ring-ring flex w-full items-center gap-3 rounded-xl! p-4 text-left focus-visible:ring-2"
          >
            <entry.icon className="text-primary size-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{entry.title}</span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {entry.description}
              </span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </button>
        ))}
      </SettingsCard>
      <Dialog
        open={document !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDocument(null);
          }
        }}
      >
        <DialogContent className="flex h-[85dvh] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl! p-0">
          <div className="border-border/60 shrink-0 border-b p-4 pr-14">
            <DialogTitle className="text-base">{document?.title}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              Your rights and responsibilities
            </DialogDescription>
          </div>
          {document ? (
            <div key={document.path} className="min-h-0 flex-1 overflow-y-auto">
              {document.path === "/toc" ? (
                <TermsDocument embedded />
              ) : (
                <PrivacyDocument embedded />
              )}
            </div>
          ) : null}
          <div className="border-border/60 flex shrink-0 justify-end border-t p-3">
            <Button variant="premium" onClick={() => setDocument(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
