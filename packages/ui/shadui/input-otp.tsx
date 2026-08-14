"use client";

import { OTPInput, OTPInputContext } from "input-otp";
import React from "react";

import { cn } from "../lib/utils";

const InputOTP = ({
  className,
  containerClassName,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof OTPInput> & {
  ref?: React.Ref<React.ElementRef<typeof OTPInput> | null>;
}) => (
  <OTPInput
    className={cn("disabled:cursor-not-allowed", className)}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName
    )}
    ref={ref}
    {...props}
  />
);
InputOTP.displayName = "InputOTP";

const InputOTPGroup = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<"div"> & {
  ref?: React.Ref<React.ElementRef<"div"> | null>;
}) => (
  <div
    className={cn("flex items-center gap-1.5 sm:gap-2", className)}
    ref={ref}
    {...props}
  />
);
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = ({
  index,
  className,
  ref,
  ...props
}: (React.ComponentPropsWithoutRef<"div"> & { index: number }) & {
  ref?: React.Ref<React.ElementRef<"div"> | null>;
}) => {
  const inputOtpContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOtpContext.slots[index];

  return (
    <div
      className={cn(
        "premium-otp-slot focus-within:ring-primary/20 relative flex h-10 w-10 items-center justify-center rounded-lg text-xl font-bold transition-all duration-200 focus-within:ring-2 sm:h-14 sm:w-12 sm:rounded-xl sm:text-2xl",
        isActive && "z-10",
        char && "border-primary/60",
        className
      )}
      data-active={isActive}
      ref={ref}
      {...props}
    >
      {char}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink bg-primary h-6 w-0.5 sm:h-9" />
        </div>
      ) : null}
    </div>
  );
};
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<"hr"> & {
  ref?: React.Ref<React.ElementRef<"hr"> | null>;
}) => (
  <hr
    className={cn(
      "bg-border flex h-4 w-[1px] items-center justify-center",
      className
    )}
    ref={ref}
    {...props}
  />
);
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };
