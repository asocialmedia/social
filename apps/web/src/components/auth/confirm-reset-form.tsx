"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import resetImage from "@assets/auth/confirm-reset-image.jpg";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { ControllerRenderProps } from "react-hook-form";
import { z } from "zod";

import { resetPassword } from "@/app/(auth)/reset-password/server-actions";
import { useToast } from "@/lib/gooey-toast";

import { LoadingButton } from "./loading-button";
import { PasswordInput } from "./password-input";
import { PasswordStrengthChecker } from "./password-strength-checker";

const schema = z
  .object({
    confirmPassword: z.string(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(
        /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        "Password must include: uppercase & lowercase letters, number, and special character"
      ),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ConfirmResetFormValues = z.infer<typeof schema>;

const PasswordFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<ConfirmResetFormValues, "password">;
}) => (
  <FormItem>
    <FormLabel>New Password</FormLabel>
    <FormControl>
      <div className="relative">
        <PasswordInput {...field} className="focus-visible:ring-blue-400" />
      </div>
    </FormControl>
    <PasswordStrengthChecker password={field.value} />
    <FormMessage />
  </FormItem>
);

const ConfirmPasswordFieldRenderer = ({
  field,
}: {
  field: ControllerRenderProps<ConfirmResetFormValues, "confirmPassword">;
}) => (
  <FormItem>
    <FormLabel>Confirm Password</FormLabel>
    <FormControl>
      <div className="relative">
        <PasswordInput {...field} className="focus-visible:ring-blue-400" />
      </div>
    </FormControl>
    <FormMessage />
  </FormItem>
);

export default function ConfirmResetForm() {
  const [token, setToken] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isPending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const handleRequestNewLink = useCallback(() => {
    router.push("/reset-password");
  }, [router]);

  const form = useForm<ConfirmResetFormValues>({
    defaultValues: {
      confirmPassword: "",
      password: "",
    },
    resolver: zodResolver(schema),
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
            description:
              data.error || "Please request a new password reset link.",
            title: "Invalid Reset Link",
            variant: "destructive",
          });
          await router.push("/reset-password");
          return;
        }

        setIsTokenValid(true);
      } catch {
        toast({
          description: "Couldn't check that link, try again?",
          title: "Couldn't Check",
          variant: "destructive",
        });
        await router.push("/reset-password");
      } finally {
        setIsValidating(false);
      }
    }

    const tokenParam = searchParams.get("token");
    if (!tokenParam) {
      toast({
        description: "Please request a new password reset link.",
        title: "Invalid Reset Link",
        variant: "destructive",
      });
      router.push("/reset-password");
      return;
    }

    // eslint-disable-next-line react-compiler -- store the validated token before fetching its status
    setToken(tokenParam);
    validateToken(tokenParam);
  }, [searchParams, router, toast]);

  function onSubmit(values: ConfirmResetFormValues) {
    if (!(token && isTokenValid)) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await resetPassword({
          password: values.password,
          token,
        });

        if (result.error) {
          toast({
            description: result.error,
            title: "Couldn't Reset",
            variant: "destructive",
          });
          return;
        }

        toast({
          description: "You're all set, log in with your new password!",
          title: "Password Reset",
        });

        router.push("/login");
      } catch {
        toast({
          description: "Couldn't reset your password, try again?",
          title: "Couldn't Reset",
          variant: "destructive",
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
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
              }}
            />
            <motion.div
              animate={{ rotate: 360 }}
              className="absolute inset-2 rounded-full border-2 border-blue-400"
              style={{ borderRightColor: "transparent" }}
              transition={{
                duration: 1,
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
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
          className="bg-card/40 rounded-lg border border-white/10 p-8 text-center backdrop-blur-xl"
          initial={{ opacity: 0, scale: 0.9 }}
        >
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <AlertCircle className="text-destructive mx-auto mb-4 h-12 w-12" />
          </motion.div>
          <p className="text-destructive mb-2 text-lg font-medium">
            Invalid or expired reset link
          </p>
          <p className="text-muted-foreground mb-6">
            The reset link you're trying to use is no longer valid.
          </p>
          <Button
            className="bg-blue-400 text-white hover:bg-blue-500"
            onClick={handleRequestNewLink}
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
        className="bg-background relative flex min-h-screen overflow-hidden"
        initial={{ opacity: 0 }}
      >
        <div className="from-primary/5 via-background to-background/95 absolute inset-0 z-0 bg-linear-to-bl" />
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="absolute left-20 hidden h-full items-center md:flex"
          initial={{ opacity: 0, x: -50 }}
          transition={{ delay: 0.3 }}
        >
          <div className="relative">
            <h1 className="vertical-left text-3d absolute top-1/2 left-0 -translate-y-1/2 text-6xl font-bold tracking-wider whitespace-nowrap select-none xl:text-8xl 2xl:text-9xl">
              CONFIRM
            </h1>
          </div>
        </motion.div>

        <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="border-border bg-card relative flex w-full max-w-5xl flex-col-reverse items-stretch overflow-hidden rounded-2xl border shadow-2xl lg:h-130 lg:flex-row"
            initial={{ opacity: 0, y: 20 }}
            transition={{ delay: 0.2 }}
          >
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="bg-primary/80 relative hidden w-full lg:flex lg:h-full lg:w-1/2"
              initial={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <motion.div
                animate={{ opacity: 1 }}
                className="to-primary/20 absolute inset-0 bg-linear-to-b from-transparent"
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

            <div className="relative z-10 flex w-full flex-col justify-center px-6 py-10 sm:px-8 lg:w-1/2">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto w-full max-w-sm"
                initial={{ opacity: 0, y: 20 }}
                transition={{ delay: 0.4 }}
              >
                <motion.h2
                  animate={{ opacity: 1 }}
                  className="mb-6 text-center text-3xl font-bold text-[#ff9500]"
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
                      render={PasswordFieldRenderer}
                    />

                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={ConfirmPasswordFieldRenderer}
                    />

                    <LoadingButton
                      className="w-full"
                      loading={isPending}
                      type="submit"
                      variant="premium"
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
          className="absolute top-0 right-0 h-full w-full bg-cover bg-center opacity-5 blur-md lg:w-1/2"
          initial={{ opacity: 0 }}
          style={{
            backgroundImage: `url(${resetImage.src})`,
          }}
          transition={{ duration: 1 }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
