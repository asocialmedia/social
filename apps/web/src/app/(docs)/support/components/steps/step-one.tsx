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
import { SUPPORT_TYPES } from "../../constants";
import type { StepProps } from "../../types";

export function StepOne({ formData, setFormData, onNext }: StepProps) {
  return (
    <motion.div
      animate="center"
      className="space-y-4"
      exit="exit"
      initial="enter"
      variants={stepVariants}
    >
      <div className="space-y-2">
        <h3 className="font-semibold text-lg">Basic Information</h3>
        <p className="text-muted-foreground text-sm">
          Let's start with your contact information
        </p>
      </div>

      <div className="space-y-4">
        <Input
          className="w-full bg-background/50 backdrop-blur-sm"
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          placeholder="Your email address"
          required
          type="email"
          value={formData.email}
        />

        <Select
          onValueChange={(value) => setFormData({ ...formData, type: value })}
          value={formData.type}
        >
          <SelectTrigger className="w-full bg-background/50 backdrop-blur-sm">
            <SelectValue placeholder="Type of support needed" />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
          <Button
            className="w-full"
            disabled={!(formData.email && formData.type)}
            onClick={onNext}
            type="button"
          >
            Continue
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}

const stepVariants = {
  enter: { opacity: 0, x: 20 },
  center: { opacity: 1, x: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.3 } },
};
