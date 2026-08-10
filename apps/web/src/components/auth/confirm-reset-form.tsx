"use client";

import resetImage from "@assets/auth/confirm-reset-image.jpg";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@asm/ui/hooks/use-toast";
import { Button } from "@asm/ui/shadui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { AlertCircle, Lock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { resetPassword } from "@/app/(auth)/reset-password/server-actions";
import { LoadingButton } from "./loading-button";
import { PasswordInput } from "./password-input";
import { PasswordStrengthChecker } from "./password-strength-checker";

const schema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(
        /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        "Password must include: uppercase & lowercase letters, number, and special character"
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const PasswordResetAnimation = () => (
  <motion.div className="relative mx-auto mb-8 h-24 w-24">
    <motion.div
      animate={{
        scale: [1, 1.1, 1],
        opacity: [0.5, 1, 0.5],
      }}
      className="absolute inset-0"
      transition={{
        duration: 2,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
    >
      <div className="h-full w-full rounded-full bg-blue-400/10" />
    </motion.div>

    <motion.div
      animate={{ rotate: 360 }}
      className="absolute inset-0"
      transition={{
        duration: 10,
        repeat: Number.POSITIVE_INFINITY,
        ease: "linear",
      }}
    >
      {["top", "right", "bottom", "left"].map((position, index) => (
        <motion.div
          className="absolute h-2 w-2"
          key={`loading-${position}`}
          style={{
            top: "50%",
            left: "50%",
            transform: `rotate(${index * 90}deg) translate(32px) rotate(-${index * 90}deg)`,
          }}
        >
          <div className="h-full w-full rounded-full bg-blue-400/60" />
        </motion.div>
      ))}
    </motion.div>

    <motion.div
      animate={{
        scale: [1, 1.1, 1],
      }}
      className="absolute inset-0 flex items-center justify-center"
      transition={{
        duration: 2,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
    >
      <Lock className="h-8 w-8 text-blue-400" />
    </motion.div>
  </motion.div>
);

export default function ConfirmResetForm() {
  const [token, setToken] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    async function validateToken(tokenToValidate: string) {
      try {
        const response = await fetch(
          `/api/reset-password?token=${tokenToValidate}`
        );
        const data = await response.json();

        if (!response.ok || data.error) {
          toast({
            variant: "destructive",
            title: "Invalid Reset Link",
            description:
              data.error || "Please request a new password reset link.",
          });
          await router.push("/reset-password");
          return;
        }

        setIsTokenValid(true);
      } catch {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to validate reset link. Please try again.",
        });
        await router.push("/reset-password");
      } finally {
        setIsValidating(false);
      }
    }

    const tokenParam = searchParams.get("token");
    if (!tokenParam) {
      toast({
        variant: "destructive",
        title: "Invalid Reset Link",
        description: "Please request a new password reset link.",
      });
      router.push("/reset-password");
      return;
    }

    setToken(tokenParam);
    validateToken(tokenParam);
  }, [searchParams, router, toast]);

  function onSubmit(values: z.infer<typeof schema>) {
    if (!(token && isTokenValid)) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await resetPassword({
          token,
          password: values.password,
        });

        if (result.error) {
          toast({
            variant: "destructive",
            title: "Error",
            description: result.error,
          });
          return;
        }

        toast({
          title: "Success",
          description: "Your password has been reset successfully.",
        });

        router.push("/login");
      } catch {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to reset password. Please try again.",
        });
      }
    });
  }

  if (isValidating) {
    return (
      <div className="container flex min-h-screen items-center justify-center">
        <motion.div
          animate={{ opacity: 1 }}
          className="text-center"
          initial={{ opacity: 0 }}
        >
          <div className="relative mx-auto mb-4 h-12 w-12">
            <motion.div
              animate={{ rotate: 360 }}
              className="absolute inset-0 rounded-full border-2 border-blue-400/20"
              transition={{
                duration: 2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
            <motion.div
              animate={{ rotate: 360 }}
              className="absolute inset-2 rounded-full border-2 border-blue-400"
              style={{ borderRightColor: "transparent" }}
              transition={{
                duration: 1,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          </div>
          <p className="text-muted-foreground">Validating reset link...</p>
        </motion.div>
      </div>
    );
  }

  if (!isTokenValid) {
    return (
      <div className="container flex min-h-screen items-center justify-center">
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-lg border border-white/10 bg-card/40 p-8 text-center backdrop-blur-xl"
          initial={{ opacity: 0, scale: 0.9 }}
        >
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          </motion.div>
          <p className="mb-2 font-medium text-destructive text-lg">
            Invalid or expired reset link
          </p>
          <p className="mb-6 text-muted-foreground">
            The reset link you're trying to use is no longer valid.
          </p>
          <Button
            className="bg-blue-400 text-white hover:bg-blue-500"
            onClick={() => router.push("/reset-password")}
          >
            Request New Reset Link
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="relative flex min-h-screen overflow-hidden bg-background"
        initial={{ opacity: 0 }}
      >
        <div className="absolute inset-0 z-0 bg-gradient-to-bl from-blue-400/5 via-background to-background/95" />
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="absolute left-20 hidden h-full items-center md:flex"
          initial={{ opacity: 0, x: -50 }}
          transition={{ delay: 0.3 }}
        >
          <div className="relative">
            <h1
              className="absolute origin-center -rotate-90 transform select-none whitespace-nowrap font-bold text-6xl text-blue-400/20 tracking-wider xl:text-8xl 2xl:text-9xl"
              style={{
                transformOrigin: "center",
                left: "-50%",
                transform: "translateX(-50%) translateY(-50%) rotate(-90deg)",
              }}
            >
              CONFIRM
            </h1>
          </div>
        </motion.div>

        <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <motion.div
            animate={{ y: 0, opacity: 1 }}
            className="relative flex w-full max-w-5xl flex-col-reverse overflow-hidden rounded-2xl border border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl lg:flex-row"
            initial={{ y: 20, opacity: 0 }}
            transition={{ delay: 0.2 }}
          >
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="relative min-h-[200px] w-full bg-blue-400/80 lg:min-h-[600px] lg:w-1/2"
              initial={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <motion.div
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-gradient-to-b from-transparent to-blue-400/20"
                initial={{ opacity: 0 }}
                transition={{ duration: 1 }}
              />
              <Image
                alt="Reset password illustration"
                className="object-cover brightness-95"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                src={resetImage}
              />
            </motion.div>

            <div className="relative z-10 flex w-full flex-col justify-center px-6 py-12 sm:px-8 lg:w-1/2">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto w-full max-w-sm"
                initial={{ opacity: 0, y: 20 }}
                transition={{ delay: 0.4 }}
              >
                <PasswordResetAnimation />

                <motion.h2
                  animate={{ opacity: 1 }}
                  className="mb-6 text-center font-bold text-3xl text-blue-400"
                  initial={{ opacity: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  Set New Password
                </motion.h2>

                <Form {...form}>
                  <form
                    className="space-y-4"
                    onSubmit={form.handleSubmit(onSubmit)}
                  >
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <PasswordInput
                                {...field}
                                className="focus-visible:ring-blue-400"
                              />
                            </div>
                          </FormControl>
                          {/* @ts-expect-error */}
                          <PasswordStrengthChecker password={field.value} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <PasswordInput
                                {...field}
                                className="focus-visible:ring-blue-400"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <LoadingButton
                      className="w-full bg-blue-400 hover:bg-blue-500"
                      loading={isPending}
                      type="submit"
                    >
                      Reset Password
                    </LoadingButton>
                  </form>
                </Form>
              </motion.div>
            </div>
          </motion.div>
        </div>

        <motion.div
          animate={{ opacity: 0.05 }}
          className="absolute top-0 right-0 h-full w-full bg-center bg-cover opacity-5 blur-md lg:w-1/2"
          initial={{ opacity: 0 }}
          style={{
            backgroundImage: `url(${resetImage.src})`,
            backgroundColor: "rgba(96, 165, 250, 0.1)",
          }}
          transition={{ duration: 1 }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
