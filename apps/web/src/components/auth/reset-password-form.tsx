"use client";

import resetImage from "@assets/auth/password-reset-image.jpg";
import { zodResolver } from "@hookform/resolvers/zod";
import { EMAIL_REGEX, USERNAME_REGEX } from "@asm/auth/validation";
import { useToast } from "@asm/ui/hooks/use-toast";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@asm/ui/shadui/form";
import { Input } from "@asm/ui/shadui/input";
import { ArrowLeft, KeyRound, Mail } from "lucide-react";
import { easeInOut } from "motion";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { requestPasswordReset } from "@/app/(auth)/reset-password/server-actions";
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

const floatAnimation = {
  initial: { y: 0 },
  animate: {
    y: [-10, 10, -10],
  },
};

function ResetAnimation() {
  return (
    <motion.div className="relative mx-auto mb-8 h-24 w-24">
      <motion.div
        animate={{
          rotate: 360,
        }}
        className="absolute inset-0 rounded-full border-4 border-blue-400/20"
        transition={{
          duration: 8,
          ease: "linear",
          repeat: Number.POSITIVE_INFINITY,
        }}
      />

      <motion.div
        animate={{
          rotate: -360,
        }}
        className="absolute inset-2 rounded-full border-4 border-blue-400/30"
        transition={{
          duration: 4,
          ease: "linear",
          repeat: Number.POSITIVE_INFINITY,
        }}
      />

      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.5, 1, 0.5],
        }}
        className="absolute inset-0 flex items-center justify-center"
        transition={{
          duration: 2,
          ease: "easeInOut",
          repeat: Number.POSITIVE_INFINITY,
        }}
      >
        <div className="rounded-full bg-blue-400/10 p-4 backdrop-blur-sm">
          <KeyRound className="h-8 w-8 text-blue-400" />
        </div>
      </motion.div>

      {["dot1", "dot2", "dot3"].map((dotId, index) => (
        <motion.div
          animate={{
            scale: [0, 1, 0],
            x: [0, Math.cos((index * Math.PI * 2) / 3) * 50],
            y: [0, Math.sin((index * Math.PI * 2) / 3) * 50],
            opacity: [0, 1, 0],
          }}
          className="absolute h-2 w-2 rounded-full bg-blue-400"
          initial={{ scale: 0, x: 0, y: 0 }}
          key={`reset-${dotId}`}
          transition={{
            duration: 2,
            delay: index * 0.6,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      ))}
    </motion.div>
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
              title: "Error",
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
            title: "Error",
            description: "Failed to send reset email. Please try again.",
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
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-blue-400/5 via-background to-background/95" />
        <motion.div
          className="absolute right-20 hidden h-full items-center md:flex"
          variants={itemVariants}
        >
          <div className="relative">
            <h1
              className="absolute origin-center rotate-90 transform select-none whitespace-nowrap font-bold text-6xl text-blue-400/20 tracking-wider xl:text-8xl 2xl:text-9xl"
              style={{
                transformOrigin: "center",
                right: "-50%",
                transform: "translateX(50%) translateY(-50%) rotate(90deg)",
              }}
            >
              RESET
            </h1>
          </div>
        </motion.div>

        <div className="relative z-10 flex flex-1 items-center justify-center p-4 sm:p-8">
          <motion.div
            className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/40 shadow-2xl backdrop-blur-xl lg:flex-row"
            variants={itemVariants}
            whileHover={{
              boxShadow: "0 25px 50px -12px rgba(59, 130, 246, 0.25)",
            }}
          >
            <div className="relative z-10 flex w-full flex-col justify-center px-6 py-12 sm:px-8 lg:w-1/2">
              <motion.div
                className="mx-auto w-full max-w-sm"
                variants={itemVariants}
              >
                <Link
                  className="mb-8 inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-blue-400"
                  href="/login"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to login
                </Link>

                <ResetAnimation />

                <motion.h2
                  className="mb-6 text-center font-bold text-3xl text-blue-400 sm:text-4xl"
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
                      <motion.div
                        animate="animate"
                        className="mb-6 inline-block"
                        initial="initial"
                        transition={{
                          duration: 6,
                          repeat: Number.POSITIVE_INFINITY,
                          ease: easeInOut,
                        }}
                        variants={floatAnimation}
                      >
                        <div className="rounded-full bg-blue-400/10 p-4">
                          <Mail className="h-8 w-8 text-blue-400" />
                        </div>
                      </motion.div>
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
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Username or Email</FormLabel>
                                <FormControl>
                                  <div className="relative">
                                    <Input
                                      {...field}
                                      className="pr-10 focus-visible:ring-blue-400"
                                      placeholder="Enter your username or email"
                                      type="text"
                                      value={field.value ?? ""}
                                    />
                                    <Mail className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                            Send Reset Link
                          </LoadingButton>
                        </form>
                      </Form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="relative min-h-[200px] w-full bg-blue-400/80 lg:min-h-[600px] lg:w-1/2"
              initial={{ opacity: 0, x: 50 }}
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
          </motion.div>
        </div>

        <motion.div
          animate={{ opacity: 0.05 }}
          className="absolute top-0 left-0 h-full w-full bg-center bg-cover opacity-5 blur-md lg:w-1/2"
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
