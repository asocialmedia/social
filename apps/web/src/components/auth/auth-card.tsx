"use client";

import loginImage from "@assets/auth/login-image.jpg";
import signupImage from "@assets/auth/signup-image.jpg";
import loginPreview from "@assets/previews/login.png";
import signupPreview from "@assets/previews/signup.png";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useCallback, useState } from "react";
import GoogleSignInButton from "@/app/(auth)/client/google-sign-in-button";
import RedditSignInButton from "@/app/(auth)/client/reddit-sign-in-button";
import AnimatedAuthLink from "@/components/auth/animated-auth-link";
import AuthButtonWrapper from "@/components/auth/auth-button-wrapper";
import LoginForm from "@/components/auth/login-form";
import SignUpForm from "@/components/auth/sign-up-form";

type AuthMode = "login" | "signup";

const switchTransition = {
  duration: 0.5,
  ease: [0.22, 1, 0.36, 1] as const,
};

export default function AuthCard({
  mode,
  onSwitch,
}: {
  mode: AuthMode;
  onSwitch: (mode: AuthMode) => void;
}) {
  const [activeProvider, setActiveProvider] = useState<
    "google" | "reddit" | null
  >(null);

  const isLogin = mode === "login";
  const isLoading = activeProvider !== null;
  const end = () => setActiveProvider(null);
  const isImageLeft = isLogin;

  const handleGoogleStart = useCallback(() => setActiveProvider("google"), []);
  const handleRedditStart = useCallback(() => setActiveProvider("reddit"), []);

  const switchMode = useCallback(() => {
    const next = mode === "login" ? "signup" : "login";
    onSwitch(next);
  }, [mode, onSwitch]);

  return (
    <div className="relative flex w-full max-w-5xl flex-col items-stretch overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:h-[520px] lg:flex-row">
      {/* Image half — flips sides with the mode */}
      <div
        className={`relative hidden overflow-hidden lg:flex lg:w-1/2 ${
          isImageLeft ? "order-1 rounded-l-2xl" : "order-2 rounded-r-2xl"
        }`}
      >
        <AnimatePresence initial={false}>
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0"
            exit={{ opacity: 0, scale: 1.06 }}
            initial={{ opacity: 0, scale: 1.06 }}
            key={mode}
            transition={switchTransition}
          >
            <Image
              alt={isLogin ? "Login illustration" : "Signup illustration"}
              className="object-cover brightness-95"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              src={isLogin ? loginImage : signupImage}
            />
          </motion.div>
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-primary/20" />
      </div>

      {/* Form half */}
      <div
        className={`relative flex w-full flex-col justify-center px-6 py-6 sm:px-8 lg:w-1/2 ${
          isImageLeft ? "order-2" : "order-1"
        }`}
      >
        <div className="relative mx-auto h-[480px] w-full max-w-sm">
          <AnimatePresence initial={false}>
            <motion.div
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key={mode}
              transition={switchTransition}
            >
              <div className="w-full">
                {isLogin ? (
                  <LoginContent
                    activeProvider={activeProvider}
                    end={end}
                    isLoading={isLoading}
                    onGoogleStart={handleGoogleStart}
                    onRedditStart={handleRedditStart}
                    onSwitch={switchMode}
                  />
                ) : (
                  <SignupContent onSwitch={switchMode} />
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function LoginContent({
  activeProvider,
  end,
  isLoading,
  onGoogleStart,
  onRedditStart,
  onSwitch,
}: {
  activeProvider: "google" | "reddit" | null;
  end: () => void;
  isLoading: boolean;
  onGoogleStart: () => void;
  onRedditStart: () => void;
  onSwitch: () => void;
}) {
  return (
    <>
      <h2 className="mb-6 text-center font-bold text-3xl text-[#ff9500] sm:text-4xl">
        Welcome Back
      </h2>

      <div className="mb-3 grid grid-cols-1 gap-0 sm:grid-cols-2 md:gap-2">
        <AuthButtonWrapper className="w-full">
          <GoogleSignInButton
            disabled={isLoading && activeProvider !== "google"}
            loading={activeProvider === "google"}
            onEnd={end}
            onStart={onGoogleStart}
          />
        </AuthButtonWrapper>
        <AuthButtonWrapper className="w-full">
          <RedditSignInButton
            disabled={isLoading && activeProvider !== "reddit"}
            loading={activeProvider === "reddit"}
            onEnd={end}
            onStart={onRedditStart}
          />
        </AuthButtonWrapper>
      </div>

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-muted" />
        <span className="px-2 text-muted-foreground text-sm">OR</span>
        <div className="h-px flex-1 bg-muted" />
      </div>

      <LoginForm />

      <div className="mt-6 text-center">
        <AnimatedAuthLink
          href="/signup"
          onSwitch={onSwitch}
          previewImage={signupPreview.src}
          text="Don't have an account? Sign Up"
        />
      </div>
    </>
  );
}

function SignupContent({ onSwitch }: { onSwitch: () => void }) {
  return (
    <>
      <h2 className="mb-6 text-center font-bold text-3xl text-[#ff9500] sm:text-4xl">
        Launch Your Journey
      </h2>

      <SignUpForm />

      <div className="mt-4 text-center">
        <AnimatedAuthLink
          href="/login"
          onSwitch={onSwitch}
          previewImage={loginPreview.src}
          text="Already have an account? Login"
        />
      </div>
    </>
  );
}
