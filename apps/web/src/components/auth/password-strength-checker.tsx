"use client";

import type { SignUpValues } from "@asm/auth/validation";
import { Check, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { UseFormSetValue } from "react-hook-form";
import { PasswordRecommender } from "./password-recommender";

interface Requirement {
  text: string;
  validator: (password: string) => boolean;
}

export const uppercaseRegex = /[A-Z]/;
export const lowercaseRegex = /[a-z]/;
export const onenumberRegex = /[0-9]/;
export const specialCharRegex = /[@$!%*?&#]/;
const numberRegex = /\d/;
const repeatedCharRegex = /(.)\1{2,}/;
const commonSequenceRegex = /(?:abc|123|qwe|xyz)/i;

const requirements: Requirement[] = [
  {
    text: "At least 8 characters long",
    validator: (password) => password.length >= 8,
  },
  {
    text: "Contains at least one uppercase letter",
    validator: (password) => uppercaseRegex.test(password),
  },
  {
    text: "Contains at least one lowercase letter",
    validator: (password) => lowercaseRegex.test(password),
  },
  {
    text: "Contains at least one number",
    validator: (password) => numberRegex.test(password),
  },
  {
    text: "Contains at least one special character",
    validator: (password) => specialCharRegex.test(password),
  },
  {
    text: "No repeated characters (3+ times)",
    validator: (password) => !repeatedCharRegex.test(password),
  },
  {
    text: "No common sequences (123, abc)",
    validator: (password) => !commonSequenceRegex.test(password),
  },
];

interface PasswordStrengthCheckerProps {
  password: string;
  setPassword: (value: string) => void;
  setValue: UseFormSetValue<SignUpValues>;
}

export function PasswordStrengthChecker({
  password,
  setValue,
  setPassword,
}: PasswordStrengthCheckerProps) {
  const getStrengthPercent = () => {
    if (!password) {
      return 0;
    }
    const matchedRequirements = requirements.filter((req) =>
      req.validator(password)
    ).length;
    return (matchedRequirements / requirements.length) * 100;
  };

  const strengthPercent = getStrengthPercent();

  const getStrengthColor = () => {
    if (strengthPercent <= 25) {
      return "bg-red-500";
    }
    if (strengthPercent <= 50) {
      return "bg-orange-500";
    }
    if (strengthPercent <= 75) {
      return "bg-yellow-500";
    }
    return "bg-green-500";
  };

  const getStrengthText = () => {
    if (strengthPercent <= 25) {
      return "Weak";
    }
    if (strengthPercent <= 50) {
      return "Fair";
    }
    if (strengthPercent <= 75) {
      return "Good";
    }
    return "Strong";
  };

  const strengthVariants = {
    container: {
      initial: { opacity: 0, height: 0 },
      animate: { opacity: 1, height: "auto" },
      exit: { opacity: 0, height: 0, transition: { duration: 0.2 } },
    },
    indicator: {
      initial: { width: 0, opacity: 0 },
      animate: { width: `${strengthPercent}%`, opacity: 1 },
      exit: { width: 0, opacity: 0 },
    },
    requirement: {
      initial: { opacity: 0, x: -10 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: 10 },
    },
  };

  return (
    <AnimatePresence mode="wait">
      {password.length > 0 && (
        <motion.div
          animate="animate"
          className="mt-2 space-y-3"
          exit="exit"
          initial="initial"
          variants={strengthVariants.container}
        >
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                animate={{ width: `${strengthPercent}%` }}
                className={`h-full rounded-full ${getStrengthColor()}`}
                initial={{ width: 0 }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Password Strength:</span>
              <motion.span
                animate={{ opacity: 1 }}
                className={`font-medium ${getStrengthColor().replace("bg-", "text-")}`}
                initial={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {getStrengthText()}
              </motion.span>
            </div>
          </div>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2 rounded-lg border p-3"
            initial={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            <PasswordRecommender
              password={password}
              requirements={requirements}
              setPassword={setPassword}
              setValue={setValue}
            />

            <p className="text-muted-foreground text-xs">
              Password Requirements:
            </p>

            <div className="space-y-2">
              {requirements.map((req, _index) => (
                <div className="flex items-center gap-2" key={req.text}>
                  <AnimatePresence mode="wait">
                    {req.validator(password) ? (
                      <motion.div
                        animate={{ scale: 1 }}
                        className="text-green-500"
                        exit={{ scale: 0 }}
                        initial={{ scale: 0 }}
                        key="check"
                      >
                        <Check className="size-4" />
                      </motion.div>
                    ) : (
                      <motion.div
                        animate={{ scale: 1 }}
                        className="text-muted-foreground"
                        exit={{ scale: 0 }}
                        initial={{ scale: 0 }}
                        key="x"
                      >
                        <X className="size-4" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <span
                    className={`text-xs ${
                      req.validator(password)
                        ? "text-green-500"
                        : "text-muted-foreground"
                    }`}
                  >
                    {req.text}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
