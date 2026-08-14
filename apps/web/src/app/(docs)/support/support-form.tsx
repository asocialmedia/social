"use client";

import { clientLog } from "@asm/config/debug";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/lib/gooey-toast";

import { StepIndicator } from "./components/step-indicator";
import { StepOne } from "./components/steps/step-one";
import { StepThree } from "./components/steps/step-three";
import { StepTwo } from "./components/steps/step-two";
import type { Attachment } from "./types";

async function uploadFile(file: File) {
  const fileFormData = new FormData();
  fileFormData.append("file", file);
  fileFormData.append("fileName", file.name);
  fileFormData.append("fileType", file.type);

  const response = await fetch("/api/support/upload", {
    body: fileFormData,
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Upload failed");
  }

  return response.json();
}

export default function SupportForm() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [formData, setFormData] = useState({
    browser: navigator.userAgent,
    category: "",
    email: "",
    message: "",
    os: navigator.platform,
    priority: "medium",
    subject: "",
    type: "",
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
      }[] = await Promise.all(
        attachments.map(async (file) => {
          const uploadFormData = new FormData();
          uploadFormData.append("file", file.file);

          const response = await fetch("/api/support/upload", {
            body: uploadFormData,
            method: "POST",
          });

          if (!response.ok) {
            throw new Error("Failed to upload attachments");
          }

          const data = await response.json();
          return {
            key: data.key,
            name: file.name,
            type: file.type,
            url: data.url,
          };
        })
      );

      const response = await fetch("/api/support", {
        body: JSON.stringify({
          ...formData,
          attachments: uploadedFiles,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send message");
      }

      toast({
        description: "We'll get back to you as soon as we can!",
        title: "Message Sent",
      });

      setFormData({
        browser: navigator.userAgent,
        category: "",
        email: "",
        message: "",
        os: navigator.platform,
        priority: "medium",
        subject: "",
        type: "",
      });
      setAttachments([]);
      setStep(1);
    } catch (error: unknown) {
      clientLog.error("Support submit error:", error);
      toast({
        description: "Couldn't send your message, try again?",
        title: "Couldn't Send",
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
        description: `You can attach up to ${maxFiles} files`,
        title: "Too Many Files",
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
        description: "Images, PDFs, or text files only, please",
        title: "Wrong File Type",
      });
      return false;
    }

    if (file.size > maxSize) {
      toast({
        description: "Keep files under 5MB",
        title: "File Too Big",
      });
      return false;
    }

    return true;
  };

  const handleFileUpload = async (files: FileList) => {
    if (!validateFiles(files)) {
      return;
    }

    await Promise.all(
      [...files].map(async (file) => {
        if (!validateFile(file)) {
          return;
        }

        try {
          const data = await uploadFile(file);

          setAttachments((prev) => [
            ...prev,
            {
              file,
              isUploading: false,
              key: data.key,
              name: file.name,
              originalName: data.originalName,
              size: data.size,
              type: data.type,
              url: data.url,
            },
          ]);

          toast({
            description: "Your file is attached",
            title: "File Uploaded",
          });
        } catch (error: unknown) {
          clientLog.error("Upload error:", error);
          toast({
            description: "Couldn't upload that file, try again?",
            title: "Upload Failed",
            variant: "destructive",
          });
        }
      })
    );
  };

  const formContainerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, transition: { duration: 0.5 }, y: 0 },
  };

  const handleNextToStepTwo = useCallback(() => setStep(2), []);
  const handleNextToStepThree = useCallback(() => setStep(3), []);
  const handleBackToStepOne = useCallback(() => setStep(1), []);
  const handleBackToStepTwo = useCallback(() => setStep(2), []);

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
      <motion.div
        animate="visible"
        initial="hidden"
        variants={formContainerVariants}
      >
        <div className="space-y-5">
          <StepIndicator currentStep={step} totalSteps={3} />

          <form className="space-y-5" onSubmit={handleSubmit}>
            <AnimatePresence mode="wait">
              {step === 1 && (
                <StepOne
                  formData={formData}
                  onNext={handleNextToStepTwo}
                  setFormData={setFormData}
                />
              )}
              {step === 2 && (
                <StepTwo
                  formData={formData}
                  onBack={handleBackToStepOne}
                  onNext={handleNextToStepThree}
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
                  onBack={handleBackToStepTwo}
                  setAttachments={setAttachments}
                  setFormData={setFormData}
                />
              )}
            </AnimatePresence>

            <motion.div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <motion.div
                animate={{ width: `${(step / 3) * 100}%` }}
                className="h-full bg-gradient-to-r from-[#ff9500] to-[#e65500]"
                initial={{ width: "33.33%" }}
                transition={{ duration: 0.3 }}
              />
            </motion.div>
          </form>

          <div className="text-center">
            <Link
              className="text-muted-foreground hover:text-primary inline-flex items-center gap-2 text-sm transition-colors"
              href="/login"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
