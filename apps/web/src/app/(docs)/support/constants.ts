export const SUPPORT_TYPES = [
  { label: "Help Request", value: "help" },
  { label: "Bug Report", value: "bug" },
  { label: "Suggestion", value: "suggestion" },
  { label: "Other", value: "other" },
] as const;

export const CATEGORIES = [
  { label: "Account Issues", value: "account" },
  { label: "Technical Problems", value: "technical" },
  { label: "Feature Requests", value: "feature" },
  { label: "Billing Questions", value: "billing" },
  { label: "Security Concerns", value: "security" },
] as const;

export const PRIORITIES = [
  { label: "Low Priority", value: "low" },
  { label: "Medium Priority", value: "medium" },
  { label: "High Priority", value: "high" },
  { label: "Critical", value: "critical" },
] as const;
