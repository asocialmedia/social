import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@asm/ui/shadui/select";
import { motion } from "motion/react";
import { useCallback } from "react";
import { CATEGORIES, PRIORITIES } from "../../constants";
import type { StepProps } from "../../types";
import { stepVariants } from "./variants";

export function StepTwo({ formData, setFormData, onBack, onNext }: StepProps) {
  const handleCategoryChange = useCallback(
    (value: string) => {
      setFormData({ ...formData, category: value });
    },
    [formData, setFormData]
  );

  const handlePriorityChange = useCallback(
    (value: string) => {
      setFormData({ ...formData, priority: value });
    },
    [formData, setFormData]
  );

  const handleSubjectChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData({ ...formData, subject: e.target.value });
    },
    [formData, setFormData]
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
        <h3 className="font-semibold text-lg">Request Details</h3>
        <p className="text-muted-foreground text-sm">
          Help us understand your request better
        </p>
      </div>

      <div className="space-y-4">
        <Select onValueChange={handleCategoryChange} value={formData.category}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((category) => (
              <SelectItem key={category.value} value={category.value}>
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handlePriorityChange} value={formData.priority}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((priority) => (
              <SelectItem key={priority.value} value={priority.value}>
                {priority.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="w-full"
          onChange={handleSubjectChange}
          placeholder="Subject"
          required
          value={formData.subject}
        />

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
            disabled={!(formData.category && formData.subject)}
            onClick={onNext}
            type="button"
            variant="premium"
          >
            Continue
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
