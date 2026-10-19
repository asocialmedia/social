import { clientLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import { Textarea } from "@asm/ui/shadui/textarea";
import { Loader2, Upload } from "lucide-react";
import { motion } from "motion/react";
import { useCallback } from "react";

import type { StepThreeProps } from "../../types";
import { SupportMediaPreview } from "../support-media-preview";
import { stepVariants } from "./variants";

export const StepThree = ({
  formData,
  setFormData,
  onBack,
  loading,
  attachments,
  fileInputRef,
  handleFileUpload,
  setAttachments,
}: StepThreeProps) => {
  const handleMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setFormData({ ...formData, message: e.target.value });
    },
    [formData, setFormData]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const { files } = e.target;
      if (files?.length) {
        clientLog.log("Files selected:", {
          count: files.length,
          details: [...files].map((f) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          })),
        });
        handleFileUpload(files);
      }
    },
    [handleFileUpload]
  );

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      setAttachments(attachments.filter((_, i) => i !== index));
    },
    [attachments, setAttachments]
  );

  return (
    <motion.div
      animate="center"
      className="space-y-4"
      exit="exit"
      initial="enter"
      variants={stepVariants}
    >
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Additional Information</h3>
        <p className="text-muted-foreground text-sm">
          Provide more details and any relevant files
        </p>
      </div>

      <div className="space-y-4">
        <Textarea
          className="min-h-[200px] w-full"
          onChange={handleMessageChange}
          placeholder="Describe your issue or suggestion in detail..."
          required
          value={formData.message}
        />

        <div className="space-y-2">
          <input
            accept="image/*,.pdf,.doc,.docx,.txt"
            className="hidden"
            multiple
            onChange={handleFileInputChange}
            ref={fileInputRef}
            type="file"
          />

          <Button
            className="w-full"
            disabled
            onClick={handleAttachClick}
            type="button"
            variant="outline"
          >
            <Upload className="mr-2 h-4 w-4" />
            Attach Files (We are working on this feature)
          </Button>
          {attachments.length > 0 ? (
            <SupportMediaPreview
              attachments={attachments}
              onRemove={handleRemoveAttachment}
            />
          ) : null}
        </div>

        <div className="flex space-x-2">
          <Button
            className="btn-social h-9 rounded-xl px-4 text-sm"
            onClick={onBack}
            type="button"
            variant="ghost"
          >
            Back
          </Button>
          <Button
            className="flex-1"
            disabled={loading || !formData.message}
            type="submit"
            variant="premium"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Message"
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};
