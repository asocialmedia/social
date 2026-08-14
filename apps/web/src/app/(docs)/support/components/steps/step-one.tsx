import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@asm/ui/shadui/select";
import { AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useMemo, useState } from "react";

import { SUPPORT_TYPES } from "../../constants";
import type { StepProps } from "../../types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const StepOne = ({ formData, setFormData, onNext }: StepProps) => {
  const [emailTouched, setEmailTouched] = useState(false);

  const emailValid = useMemo(
    () => EMAIL_REGEX.test(formData.email),
    [formData.email]
  );

  const showEmailError = emailTouched && !emailValid;

  const handleEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData({ ...formData, email: e.target.value });
    },
    [formData, setFormData]
  );

  const handleEmailBlur = useCallback(() => {
    setEmailTouched(true);
  }, []);

  const handleTypeChange = useCallback(
    (value: string) => {
      setFormData({ ...formData, type: value });
    },
    [formData, setFormData]
  );

  const handleContinue = useCallback(() => {
    setEmailTouched(true);
    if (emailValid && formData.type) {
      onNext?.();
    }
  }, [emailValid, formData.type, onNext]);

  return (
    <motion.div
      animate="center"
      className="space-y-4"
      exit="exit"
      initial="enter"
      variants={stepVariants}
    >
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Basic Information</h3>
        <p className="text-muted-foreground text-sm">
          Let's start with your contact information
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Input
            className={`w-full ${showEmailError ? "ring-destructive/50 ring-2" : ""}`}
            onBlur={handleEmailBlur}
            onChange={handleEmailChange}
            placeholder="Your email address"
            required
            type="email"
            value={formData.email}
          />
          {showEmailError ? (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <AlertCircle className="h-3.5 w-3.5" />
              Please enter a valid email address
            </p>
          ) : null}
        </div>

        <Select onValueChange={handleTypeChange} value={formData.type}>
          <SelectTrigger className="w-full">
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

        <Button
          className="w-full"
          disabled={!(emailValid && formData.type)}
          onClick={handleContinue}
          type="button"
          variant="premium"
        >
          Continue
        </Button>
      </div>
    </motion.div>
  );
};

const stepVariants = {
  center: { opacity: 1, transition: { duration: 0.3 }, x: 0 },
  enter: { opacity: 0, x: 20 },
  exit: { opacity: 0, transition: { duration: 0.3 }, x: -20 },
};
