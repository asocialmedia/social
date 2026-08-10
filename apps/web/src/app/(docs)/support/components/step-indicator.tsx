import { motion } from "motion/react";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <span className="font-medium text-primary">
        Step {currentStep}/{totalSteps}
      </span>
      <motion.div
        animate={{ opacity: 1 }}
        className="text-muted-foreground text-sm"
        initial={{ opacity: 0 }}
      >
        {currentStep === 1 && "Basic Information"}
        {currentStep === 2 && "Request Details"}
        {currentStep === 3 && "Additional Information"}
      </motion.div>
    </div>
  );
}
