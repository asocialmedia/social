import { Button } from "@asm/ui/shadui/button";
import { Textarea } from "@asm/ui/shadui/textarea";
import { Loader2, Upload } from "lucide-react";
import { motion } from "motion/react";
import { useCallback } from "react";
import type { StepThreeProps } from "../../types";
import { SupportMediaPreview } from "../support-media-preview";
import { stepVariants } from "./variants";

export function StepThree({
  formData,
  setFormData,
  onBack,
  loading,
  attachments,
  fileInputRef,
  handleFileUpload,
  setAttachments,
}: StepThreeProps) {
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
        console.log("Files selected:", {
          count: files.length,
          details: Array.from(files).map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
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
        <h3 className="font-semibold text-lg">Additional Information</h3>
        <p className="text-muted-foreground text-sm">
          Provide more details and any relevant files
        </p>
      </div>

      <div className="space-y-4">
        <Textarea
          className="min-h-[200px] w-full bg-background/50 backdrop-blur-sm"
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
            className="w-full bg-background/50 backdrop-blur-sm"
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
            className="bg-background/50 backdrop-blur-sm"
            onClick={onBack}
            type="button"
            variant="outline"
          >
            Back
          </Button>
          <Button
            className="flex-1"
            disabled={loading || !formData.message}
            type="submit"
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
}
