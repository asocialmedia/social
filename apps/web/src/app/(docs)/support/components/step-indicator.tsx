import { motion } from "motion/react";

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

export const StepIndicator = ({
  currentStep,
  totalSteps,
}: StepIndicatorProps) => (
  <div className="mb-6 flex items-center justify-between">
    <span className="text-primary font-medium">
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
