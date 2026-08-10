import { Input } from "@asm/ui/shadui/input";
import { Eye, EyeOff } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const PasswordInput = ({
  className,
  type,
  ref,
  ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement | null> }) => {
  const [showPassword, setShowPassword] = useState(false);

  const togglePasswordVisibility = useCallback(() => {
    setShowPassword((current) => !current);
  }, []);

  return (
    <div className="relative">
      <Input
        className={cn("pe-10", className)}
        ref={ref}
        type={showPassword ? "text" : "password"}
        {...props}
      />
      <button
        className="absolute top-1/2 right-3 -translate-y-1/2 transform text-muted-foreground"
        onClick={togglePasswordVisibility}
        title={showPassword ? "Hide password" : "Show password"}
        type="button"
      >
        {showPassword ? (
          <EyeOff className="size-5" />
        ) : (
          <Eye className="size-5" />
        )}
      </button>
    </div>
  );
};

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
