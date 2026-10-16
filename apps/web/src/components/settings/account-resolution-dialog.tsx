"use client";

import type {
  AccountResolutionProfile,
  AccountResolutionReview,
} from "@asm/auth/validation";
import { Avatar, AvatarFallback, AvatarImage } from "@asm/ui/shadui/avatar";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import {
  ArrowLeft,
  Check,
  GitMerge,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

async function resolutionRequest(
  id: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/users/account-resolution/${id}`, {
    cache: "no-store",
    method: body ? "POST" : "GET",
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      data.error || data.message || "Could not review these accounts."
    );
  }
  return data;
}

function AccountVerification({
  id,
  side,
  profile,
  refresh,
}: {
  id: string;
  side: "current" | "other";
  profile: AccountResolutionProfile;
  refresh: () => Promise<void>;
}) {
  const labelId = useId();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState(profile.email ?? "");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [emailReady, setEmailReady] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  const [method, setMethod] = useState<"totp" | "backup-code" | "otp">("totp");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const needsSetup = !profile.hasPassword || !profile.emailVerified;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setErrorMessage("");
    try {
      await action();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Please try again."
      );
    }
    setBusy(false);
  }

  return (
    <section
      className="surface-3d space-y-3 rounded-2xl! p-4"
      aria-labelledby={labelId}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={labelId} className="text-sm font-semibold">
          @{profile.username}
        </h3>
        {profile.verified && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <ShieldCheck className="size-4" /> Verified
          </span>
        )}
      </div>
      {!profile.verified &&
        (needsSetup ? (
          <>
            <p className="text-muted-foreground text-xs">
              Add the missing recovery details here. Verify an inbox before
              setting a password.
            </p>
            <label
              className="block space-y-1 text-xs"
              htmlFor={`${labelId}-email`}
            >
              <span>Recovery email</span>
              <Input
                id={`${labelId}-email`}
                type="email"
                autoComplete="email"
                value={email}
                disabled={Boolean(profile.email) || busy || emailReady}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setCodeSent(false);
                }}
              />
            </label>
            {!emailReady && (
              <>
                <Button
                  type="button"
                  variant="premium-neutral"
                  size="sm"
                  disabled={busy || !email}
                  onClick={() =>
                    run(async () => {
                      await resolutionRequest(id, {
                        action: "code",
                        email,
                        side,
                      });
                      setCodeSent(true);
                    })
                  }
                >
                  {codeSent ? "Resend email code" : "Send email code"}
                </Button>
                {codeSent && (
                  <div className="flex gap-2">
                    <Input
                      aria-label={`Email verification code for ${profile.username}`}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="premium-neutral"
                      disabled={busy || code.length !== 6}
                      onClick={() =>
                        run(async () => {
                          await resolutionRequest(id, {
                            action: "code",
                            email,
                            otp: code,
                            side,
                          });
                          setEmailReady(true);
                          setCode("");
                        })
                      }
                    >
                      Verify email
                    </Button>
                  </div>
                )}
              </>
            )}
            {emailReady && (
              <>
                {!profile.hasPassword && (
                  <>
                    <label
                      className="block space-y-1 text-xs"
                      htmlFor={`${labelId}-new-password`}
                    >
                      <span>New password</span>
                      <Input
                        id={`${labelId}-new-password`}
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <label
                      className="block space-y-1 text-xs"
                      htmlFor={`${labelId}-confirm-password`}
                    >
                      <span>Confirm password</span>
                      <Input
                        id={`${labelId}-confirm-password`}
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                      />
                    </label>
                  </>
                )}
                <Button
                  type="button"
                  variant="premium-neutral"
                  disabled={
                    busy ||
                    (!profile.hasPassword &&
                      (password.length < 8 || password !== confirmPassword))
                  }
                  onClick={() =>
                    run(async () => {
                      await resolutionRequest(id, {
                        action: "setup",
                        side,
                        ...(profile.hasPassword ? {} : { password }),
                      });
                      setEmailReady(false);
                      setPassword("");
                      setConfirmPassword("");
                      await refresh();
                    })
                  }
                >
                  Save recovery details
                </Button>
              </>
            )}
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await resolutionRequest(id, {
                  action: "verify",
                  side,
                  ...(twoFactor ? { code, method } : { password }),
                });
                setPassword("");
                setCode("");
                if (result.twoFactorRequired) {
                  setTwoFactor(true);
                } else {
                  setTwoFactor(false);
                  await refresh();
                }
              });
            }}
          >
            {twoFactor ? (
              <>
                <label className="block space-y-1 text-xs">
                  <span>Two-factor method</span>
                  <select
                    className="premium-input h-10 w-full px-3 text-sm"
                    value={method}
                    onChange={(event) => {
                      const { value } = event.target;
                      if (
                        value === "totp" ||
                        value === "backup-code" ||
                        value === "otp"
                      ) {
                        setMethod(value);
                      }
                    }}
                  >
                    <option value="totp">Authenticator app</option>
                    <option value="otp">Email code</option>
                    <option value="backup-code">Backup code</option>
                  </select>
                </label>
                {method === "otp" && (
                  <Button
                    type="button"
                    variant="premium-neutral"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await resolutionRequest(id, {
                          action: "verify",
                          method: "send-otp",
                          side,
                        });
                      })
                    }
                  >
                    Send two-factor code
                  </Button>
                )}
                <label
                  className="block space-y-1 text-xs"
                  htmlFor={`${labelId}-two-factor`}
                >
                  <span>Verification code</span>
                  <Input
                    id={`${labelId}-two-factor`}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTwoFactor(false);
                    setCode("");
                  }}
                >
                  Use password again
                </Button>
              </>
            ) : (
              <label
                className="block space-y-1 text-xs"
                htmlFor={`${labelId}-password`}
              >
                <span>Password for @{profile.username}</span>
                <Input
                  id={`${labelId}-password`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
            <Button
              type="submit"
              variant="premium-neutral"
              disabled={busy || !(twoFactor ? code : password)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}{" "}
              Verify account
            </Button>
          </form>
        ))}
      {errorMessage && (
        <p role="alert" className="text-destructive text-xs">
          {errorMessage}
        </p>
      )}
    </section>
  );
}

export function AccountResolutionDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const confirmationId = useId();
  const [review, setReview] = useState<AccountResolutionReview | null>(null);
  const [keepId, setKeepId] = useState("");
  const [mode, setMode] = useState<"merge" | "discard" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const refresh = useCallback(async () => {
    const data = (await resolutionRequest(
      id
    )) as unknown as AccountResolutionReview;
    setReview(data);
    setKeepId((previous) => previous || data.current.id);
  }, [id]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await refresh();
      } catch (error) {
        if (active) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Could not load these accounts."
          );
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [refresh]);
  const kept =
    review && (keepId === review.current.id ? review.current : review.other);
  const lost =
    review && (keepId === review.current.id ? review.other : review.current);
  let protectedReason: string | null = null;
  if (lost?.protectedAccount) {
    protectedReason =
      "Keep the account with the author or administrative role.";
  } else if (lost?.ownsDen) {
    protectedReason = "Transfer ownership of this account's dens first.";
  }
  const mergeReason =
    protectedReason ||
    (lost?.privateHistory
      ? "This account has encrypted conversations. Keep this profile to preserve them; encrypted history cannot be moved to another identity."
      : null);
  const discardReason =
    protectedReason ||
    (lost?.communities
      ? "Transfer ownership of this account's communities first."
      : null);
  const canConfirm = Boolean(
    review?.current.verified &&
    review.other.verified &&
    kept &&
    lost &&
    confirmation === lost.username &&
    acknowledged &&
    !(mode === "merge" ? mergeReason : discardReason)
  );

  async function cancel() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (review) {
        await resolutionRequest(id, { action: "cancel" });
      }
      onClose();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not cancel this review."
      );
    }
    setBusy(false);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !complete) {
          void cancel();
        }
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-lg overflow-y-auto p-5 sm:p-6"
        onEscapeKeyDown={(event) => {
          if (busy || complete) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (busy || complete) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {complete ? "Accounts resolved" : "Two accounts, your choice"}
          </DialogTitle>
          <DialogDescription>
            {complete
              ? "Sign in again using the profile you kept."
              : "This sign-in method or email already belongs to another ASM account. Review both profiles before changing anything."}
          </DialogDescription>
        </DialogHeader>
        {complete ? (
          <Button
            variant="premium"
            onClick={() => {
              window.location.href = "/login?account_resolved=1";
            }}
          >
            Continue to sign in
          </Button>
        ) : (
          <>
            {!review && !errorMessage && (
              <div className="flex justify-center py-8">
                <Loader2
                  aria-label="Loading accounts"
                  className="size-6 animate-spin"
                />
              </div>
            )}
            {review && (
              <>
                <fieldset
                  className="grid grid-cols-2 gap-3"
                  aria-label="Choose the profile to keep"
                >
                  {[review.current, review.other].map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      aria-pressed={keepId === profile.id}
                      disabled={busy}
                      onClick={() => {
                        setKeepId(profile.id);
                        setConfirmation("");
                        setAcknowledged(false);
                      }}
                      className={`surface-3d flex min-w-0 flex-col items-center gap-2 rounded-2xl! p-3 text-center ${keepId === profile.id ? "ring-primary ring-2" : ""}`}
                    >
                      <Avatar className="size-14">
                        <AvatarImage
                          src={profile.avatarUrl ?? undefined}
                          alt=""
                        />
                        <AvatarFallback>
                          {profile.displayName.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-full truncate text-sm font-semibold">
                        {profile.displayName}
                      </span>
                      <span className="text-muted-foreground max-w-full truncate text-xs">
                        @{profile.username}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {profile.posts} posts · {profile.comments} comments
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {profile.providers.join(" + ") || "Email & password"}
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium">
                        {keepId === profile.id && (
                          <Check className="size-3.5" />
                        )}
                        {keepId === profile.id
                          ? "Keep this profile"
                          : "Choose this profile"}
                      </span>
                    </button>
                  ))}
                </fieldset>
                <p className="text-muted-foreground text-xs">
                  The chosen profile keeps its name, email, password, passkeys
                  and two-factor settings. Connected providers move to it. All
                  sessions end after completion.
                </p>
                {review.kind === "email" && (
                  <p className="text-xs font-medium">
                    The requested email belongs to an existing account. It will
                    stay with that profile unless you keep that profile. An
                    email change alone never combines accounts.
                  </p>
                )}
                {mode ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-fit gap-1 px-0"
                      disabled={busy}
                      onClick={() => {
                        setMode(null);
                        setConfirmation("");
                        setAcknowledged(false);
                      }}
                    >
                      <ArrowLeft className="size-4" /> Back to choices
                    </Button>
                    <p className="text-sm font-medium">
                      Verify both accounts to{" "}
                      {mode === "merge"
                        ? "merge their content"
                        : "delete the other account"}
                      .
                    </p>
                    <AccountVerification
                      id={id}
                      side="current"
                      profile={review.current}
                      refresh={refresh}
                    />
                    <AccountVerification
                      id={id}
                      side="other"
                      profile={review.other}
                      refresh={refresh}
                    />
                    <div className="space-y-3 border-t pt-4">
                      <p
                        className={
                          mode === "discard"
                            ? "text-destructive text-xs"
                            : "text-muted-foreground text-xs"
                        }
                      >
                        {mode === "discard"
                          ? `@${lost?.username}'s ${lost?.posts} posts, their replies, ${lost?.comments} comments, private messages, bookmarks and social connections will be deleted permanently. This cannot be undone.`
                          : `@${lost?.username}'s public content moves to @${kept?.username}. Duplicate relationships keep the chosen profile's entry. The retired username redirects to the chosen profile for 30 days.`}
                      </p>
                      <label className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          className="premium-checkbox mt-0.5"
                          checked={acknowledged}
                          onChange={(event) =>
                            setAcknowledged(event.target.checked)
                          }
                        />
                        <span>
                          I understand that @{lost?.username} will be retired,
                          its recovery details will no longer sign in, and this
                          cannot be undone.
                        </span>
                      </label>
                      <label
                        className="block space-y-1 text-xs"
                        htmlFor={confirmationId}
                      >
                        <span>
                          Type <strong>{lost?.username}</strong> to confirm
                        </span>
                        <Input
                          id={confirmationId}
                          autoComplete="off"
                          value={confirmation}
                          onChange={(event) =>
                            setConfirmation(event.target.value)
                          }
                        />
                      </label>
                      <Button
                        variant="premium"
                        className="w-full"
                        disabled={busy || !canConfirm}
                        onClick={async () => {
                          setBusy(true);
                          setErrorMessage("");
                          try {
                            await resolutionRequest(id, {
                              action: "resolve",
                              confirmation,
                              keepUserId: keepId,
                              mode,
                            });
                            setComplete(true);
                          } catch (error) {
                            setErrorMessage(
                              error instanceof Error
                                ? error.message
                                : "Could not resolve these accounts."
                            );
                            await refresh().catch(() => {
                              // The original error remains visible if refreshing also fails.
                            });
                          }
                          setBusy(false);
                        }}
                      >
                        {busy && (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        )}
                        {mode === "merge"
                          ? "Merge into"
                          : "Delete other account and keep"}{" "}
                        @{kept?.username}
                      </Button>
                      <Button
                        variant="premium-neutral"
                        className="w-full"
                        disabled={busy}
                        onClick={cancel}
                      >
                        Cancel — keep both accounts
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="premium-neutral"
                      className="h-auto justify-start gap-3 py-3 text-left whitespace-normal"
                      disabled={Boolean(mergeReason)}
                      onClick={() => setMode("merge")}
                    >
                      <GitMerge className="size-5 shrink-0" />
                      <span>
                        <span className="block">
                          Merge accounts into @{kept?.username}
                        </span>
                        <span className="text-muted-foreground text-xs font-normal">
                          Move posts, comments, communities, bookmarks and
                          follows.
                        </span>
                      </span>
                    </Button>
                    {mergeReason && (
                      <p className="text-muted-foreground px-2 text-xs">
                        {mergeReason}
                      </p>
                    )}
                    <Button
                      variant="premium-neutral"
                      className="text-destructive h-auto justify-start gap-3 py-3 text-left whitespace-normal"
                      disabled={Boolean(discardReason)}
                      onClick={() => setMode("discard")}
                    >
                      <Trash2 className="size-5 shrink-0" />
                      <span>
                        <span className="block">
                          Delete @{lost?.username}, keep @{kept?.username}
                        </span>
                        <span className="text-muted-foreground text-xs font-normal">
                          Permanently discard the other account's content.
                        </span>
                      </span>
                    </Button>
                    {discardReason && (
                      <p className="text-muted-foreground px-2 text-xs">
                        {discardReason}
                      </p>
                    )}
                    <Button
                      variant="premium-neutral"
                      disabled={busy}
                      onClick={cancel}
                    >
                      Cancel — keep both accounts
                    </Button>
                  </div>
                )}
              </>
            )}
            {errorMessage && (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
