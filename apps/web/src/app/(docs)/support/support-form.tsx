"use client";

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
      }[] = await Promise.all(
        attachments.map(async (file) => {
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
          return {
            url: data.url,
            key: data.key,
            name: file.name,
            type: file.type,
          };
        })
      );

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
        title: "Message Sent",
        description: "We'll get back to you as soon as we can!",
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
      console.error("Support submit error:", error);
      toast({
        title: "Couldn't Send",
        description: "Couldn't send your message, try again?",
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
        title: "Too Many Files",
        description: `You can attach up to ${maxFiles} files`,
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
        title: "Wrong File Type",
        description: "Images, PDFs, or text files only, please",
      });
      return false;
    }

    if (file.size > maxSize) {
      toast({
        title: "File Too Big",
        description: "Keep files under 5MB",
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

    await Promise.all(
      Array.from(files).map(async (file) => {
        if (!validateFile(file)) {
          return;
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
            title: "File Uploaded",
            description: "Your file is attached",
          });
        } catch (error: unknown) {
          console.error("Upload error:", error);
          toast({
            title: "Upload Failed",
            description: "Couldn't upload that file, try again?",
            variant: "destructive",
          });
        }
      })
    );
  };

  const formContainerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
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

            <motion.div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
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
              className="inline-flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-primary"
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
