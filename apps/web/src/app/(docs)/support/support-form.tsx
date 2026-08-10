"use client";

import { useToast } from "@asm/ui/hooks/use-toast";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FossBanner } from "@/components/misc/foss-banner";
import { AnimatedAsocialmediaText } from "./components/animated-asm-text";
import { GithubIssueButton } from "./components/github-issue-button";
import { StepIndicator } from "./components/step-indicator";
import { StepOne } from "./components/steps/step-one";
import { StepThree } from "./components/steps/step-three";
import { StepTwo } from "./components/steps/step-two";
import type { Attachment } from "./types";

export default function SupportForm() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [formData, setFormData] = useState({
    email: "",
    type: "",
    category: "",
    priority: "medium",
    subject: "",
    message: "",
    os: navigator.platform,
    browser: navigator.userAgent,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const uploadedFiles: {
        url: string;
        key: string;
        name: string;
        type: string;
      }[] = [];
      for (const file of attachments) {
        const uploadFormData = new FormData();
        uploadFormData.append("file", file.file);

        const response = await fetch("/api/support/upload", {
          method: "POST",
          body: uploadFormData,
        });

        if (!response.ok) {
          throw new Error("Failed to upload attachments");
        }

        const data = await response.json();
        uploadedFiles.push({
          url: data.url,
          key: data.key,
          name: file.name,
          type: file.type,
        });
      }

      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          attachments: uploadedFiles,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send message");
      }

      toast({
        title: "Message sent successfully",
        description: "We'll get back to you as soon as possible.",
      });

      setFormData({
        email: "",
        type: "",
        category: "",
        priority: "medium",
        subject: "",
        message: "",
        os: navigator.platform,
        browser: navigator.userAgent,
      });
      setAttachments([]);
      setStep(1);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to send message",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const validateFiles = (files: FileList): boolean => {
    const maxFiles = 3;
    if (attachments.length + files.length > maxFiles) {
      toast({
        title: "Too many files",
        description: `Maximum ${maxFiles} files allowed`,
      });
      return false;
    }
    return true;
  };

  const validateFile = (file: File): boolean => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "application/pdf",
      "text/plain",
    ];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!(file.type && allowedTypes.includes(file.type))) {
      toast({
        title: "Invalid file type",
        description: "Please upload images, PDFs, or text files only",
      });
      return false;
    }

    if (file.size > maxSize) {
      toast({
        title: "File too large",
        description: "Files must be less than 5MB",
      });
      return false;
    }

    return true;
  };

  const uploadFile = async (file: File) => {
    const fileFormData = new FormData();
    fileFormData.append("file", file);
    fileFormData.append("fileName", file.name);
    fileFormData.append("fileType", file.type);

    const response = await fetch("/api/support/upload", {
      method: "POST",
      body: fileFormData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Upload failed");
    }

    return response.json();
  };

  const handleFileUpload = async (files: FileList) => {
    if (!validateFiles(files)) {
      return;
    }

    for (const file of Array.from(files)) {
      if (!validateFile(file)) {
        continue;
      }

      try {
        const data = await uploadFile(file);

        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            file,
            url: data.url,
            key: data.key,
            originalName: data.originalName,
            size: data.size,
            type: data.type,
            isUploading: false,
          },
        ]);

        toast({
          title: "Success",
          description: "File uploaded successfully",
        });
      } catch (error: unknown) {
        console.error("Upload error:", error);
        toast({
          title: "Upload failed",
          description:
            error instanceof Error ? error.message : "Failed to upload file",
          variant: "destructive",
        });
      }
    }
  };

  const formContainerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  useEffect(
    () => () => {
      for (const attachment of attachments) {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
    },
    [attachments]
  );

  return (
    <div className="relative">
      <Link
        className="fixed top-8 left-8 flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
        href="/"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>

      <motion.div
        animate="visible"
        className="mx-auto mt-8 max-w-2xl"
        initial="hidden"
        variants={formContainerVariants}
      >
        <div className="rounded-xl border bg-card/30 p-6 shadow-lg backdrop-blur-md">
          <StepIndicator currentStep={step} totalSteps={3} />
          <GithubIssueButton />

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <AnimatePresence mode="wait">
              {step === 1 && (
                <StepOne
                  formData={formData}
                  onNext={() => setStep(2)}
                  setFormData={setFormData}
                />
              )}
              {step === 2 && (
                <StepTwo
                  formData={formData}
                  onBack={() => setStep(1)}
                  onNext={() => setStep(3)}
                  setFormData={setFormData}
                />
              )}
              {step === 3 && (
                <StepThree
                  attachments={attachments}
                  fileInputRef={fileInputRef}
                  formData={formData}
                  handleFileUpload={handleFileUpload}
                  loading={loading}
                  onBack={() => setStep(2)}
                  setAttachments={setAttachments}
                  setFormData={setFormData}
                />
              )}
            </AnimatePresence>

            <motion.div
              animate={{ scaleX: 1 }}
              className="h-2 w-full overflow-hidden rounded-full bg-muted/50 backdrop-blur-sm"
              initial={{ scaleX: 0 }}
            >
              <motion.div
                animate={{ width: `${(step / 3) * 100}%` }}
                className="h-full bg-primary"
                initial={{ width: "33.33%" }}
                transition={{ duration: 0.3 }}
              />
            </motion.div>
          </form>
        </div>

        <FossBanner className="mt-6" />

        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-lg border bg-card/30 p-4 text-muted-foreground text-sm backdrop-blur-md"
          initial={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Privacy Notice</span>
          </div>
          <p className="mt-2">
            To prevent abuse and ensure service quality, we collect and store
            certain information including browser details and
            sumuted-foregroundissionsm timestamps. This data is used solely for
            rate limiting and system improvements.
          </p>
        </motion.div>
      </motion.div>

      <AnimatedAsocialmediaText className="fixed right-8 bottom-8" />
    </div>
  );
}
