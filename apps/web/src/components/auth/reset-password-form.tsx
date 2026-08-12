"use client";

import { EMAIL_REGEX, USERNAME_REGEX } from "@asm/auth/validation";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import resetImage from "@assets/auth/password-reset-image.jpg";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Mail } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { type ControllerRenderProps, useForm } from "react-hook-form";
import { z } from "zod";
import { requestPasswordReset } from "@/app/(auth)/reset-password/server-actions";
import { useToast } from "@/lib/gooey-toast";
import { LoadingButton } from "./loading-button";

const schema = z.object({
  identifier: z
    .string()
    .min(1, "Please enter your username or email address")
    .refine((value) => {
      if (EMAIL_REGEX.test(value)) {
        return true;
      }
      return USERNAME_REGEX.test(value);
    }, "Please enter a valid email address or username"),
});

type FormValues = z.infer<typeof schema>;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.5,
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
    },
  },
};

function IdentifierFieldRenderer({
  field,
}: {
  field: ControllerRenderProps<FormValues, "identifier">;
}) {
  return (
    <FormItem>
      <FormLabel>Username or Email</FormLabel>
      <FormControl>
        <div className="relative">
          <Input
            {...field}
            className="pr-10"
            placeholder="Enter your username or email"
            type="text"
            value={field.value ?? ""}
          />
          <Mail className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </FormControl>
      <FormMessage />
    </FormItem>
  );
}

export default function ResetPasswordForm() {
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      identifier: "",
    },
    mode: "onChange",
  });

  function onSubmit(values: FormValues) {
    startTransition(() => {
      (async () => {
        try {
          const result = await requestPasswordReset(values);

          if (result.error) {
            const description = result.retryAfter
              ? `${result.error} Please wait ${Math.ceil(result.retryAfter / 60)} minutes before trying again.`
              : result.error;

            toast({
              variant: "destructive",
              title: "Couldn't Send",
              description,
            });
            return;
          }

          setIsEmailSent(true);
          toast({
            title: "Check Your Email",
            description:
              "If an account exists with that username or email, you'll receive password reset instructions.",
          });
        } catch {
          toast({
            variant: "destructive",
            title: "Couldn't Send",
            description: "Couldn't send the reset email, try again?",
          });
        }
      })();
    });
  }

  return (
    <AnimatePresence>
      <motion.div
        animate="visible"
        className="relative flex min-h-screen overflow-hidden bg-background"
        initial="hidden"
        variants={containerVariants}
      >
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-primary/5 via-background to-background/95" />
        <motion.div
          className="absolute right-20 hidden h-full items-center md:flex"
          variants={itemVariants}
        >
          <div className="relative">
            <h1 className="vertical-right absolute top-1/2 right-0 -translate-y-1/2 select-none whitespace-nowrap font-bold text-3d text-6xl tracking-wider xl:text-8xl 2xl:text-9xl">
              RESET
            </h1>
          </div>
        </motion.div>

        <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <motion.div
            className="relative flex w-full max-w-5xl flex-col items-stretch overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:h-[520px] lg:flex-row"
            variants={itemVariants}
          >
            <div className="relative z-10 flex w-full flex-col justify-center px-6 py-10 sm:px-8 lg:w-1/2">
              <motion.div
                className="mx-auto w-full max-w-sm"
                variants={itemVariants}
              >
                <motion.h2
                  className="mb-6 text-center font-bold text-3xl text-[#ff9500] sm:text-4xl"
                  variants={itemVariants}
                >
                  Reset Password
                </motion.h2>

                <AnimatePresence mode="wait">
                  {isEmailSent ? (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="text-center"
                      exit={{ opacity: 0, y: -20 }}
                      initial={{ opacity: 0, y: 20 }}
                      key="success"
                    >
                      <h3 className="mb-2 font-semibold text-xl">
                        Check Your Email
                      </h3>
                      <p className="text-muted-foreground">
                        If an account exists with that username or email, you'll
                        receive password reset instructions.
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      initial={{ opacity: 0, y: 20 }}
                      key="form"
                    >
                      <Form {...form}>
                        <form
                          className="space-y-4"
                          onSubmit={form.handleSubmit(onSubmit)}
                        >
                          <FormField
                            control={form.control}
                            name="identifier"
                            render={IdentifierFieldRenderer}
                          />
                          <LoadingButton
                            className="w-full"
                            loading={isPending}
                            type="submit"
                            variant="premium"
                          >
                            Send Reset Link
                          </LoadingButton>
                        </form>
                      </Form>

                      <div className="mt-6 text-center">
                        <Link
                          className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-primary"
                          href="/login"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Back to login
                        </Link>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="relative hidden w-full bg-primary/80 lg:flex lg:h-full lg:w-1/2"
              initial={{ opacity: 0, x: 50 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <motion.div
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-gradient-to-b from-transparent to-primary/20"
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
          </motion.div>
        </div>

        <motion.div
          animate={{ opacity: 0.05 }}
          className="absolute top-0 left-0 h-full w-full bg-center bg-cover opacity-5 blur-md lg:w-1/2"
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
