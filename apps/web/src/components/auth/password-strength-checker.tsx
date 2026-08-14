"use client";

import { AnimatePresence, motion } from "motion/react";

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
const repeatedCharRegex = /(?<char>.)\k<char>{2,}/;
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
}

export const PasswordStrengthChecker = ({
  password,
}: PasswordStrengthCheckerProps) => {
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

  return (
    <AnimatePresence mode="wait">
      {password.length > 0 && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="mt-2 space-y-2.5"
          exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
          initial={{ height: 0, opacity: 0 }}
        >
          <div className="space-y-2">
            <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
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

          <PasswordRecommender
            password={password}
            requirements={requirements}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
