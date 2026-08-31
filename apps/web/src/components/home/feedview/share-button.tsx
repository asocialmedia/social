"use client";

import { clientLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import authImage from "@assets/general/auth.png";
import noSearchImage from "@assets/general/nosearch.png";
import { DiscordLogoIcon } from "@radix-ui/react-icons";
import {
  Check,
  Copy,
  Download,
  Link2,
  Mail,
  QrCode,
  Share2,
} from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import type * as React from "react";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaPinterest,
  FaReddit,
  FaTwitter,
  FaWhatsapp,
} from "react-icons/fa";

import { useSession } from "@/app/(main)/session-provider";
import { MessageIdentityProvider } from "@/components/messages/message-identity-provider";
import { MessageSharePicker } from "@/components/messages/message-share-picker";
import { toast } from "@/lib/gooey-toast";
import { setPopupOpen } from "@/lib/popup-tracker";
import { cn } from "@/lib/utils";

const FALLBACK_THUMBNAIL = "/fallback.png";

// React Compiler cannot lower `throw` statements inside component try blocks,
// so response status checks live in this module-scoped helper.
function ensureResponseOk(response: Response, message: string): void {
  if (!response.ok) {
    throw new Error(message);
  }
}

interface ShareButtonProps {
  className?: string;
  defaultTab?: "social" | "link" | "qr" | "messages";
  description?: string;
  dialogDescription?: string;
  dialogTitle?: string;
  postId?: string;
  shareUrl?: string;
  thumbnail?: string;
  title?: string;
}

interface ShareStats {
  clicks: number;
  platform: string;
  shares: number;
}

const ShareButton = ({
  className,
  defaultTab = "social",
  postId,
  shareUrl,
  title,
  thumbnail,
  description,
  dialogTitle = "Share",
  dialogDescription = "Share with your network",
}: ShareButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "social" | "link" | "qr" | "messages"
  >(defaultTab);
  const [shareStats, setShareStats] = useState<ShareStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const baseUrl = typeof window === "undefined" ? "" : window.location.origin;
  const postUrl = shareUrl || (postId ? `${baseUrl}/posts/${postId}` : baseUrl);
  const { user } = useSession();
  const isLoggedIn = Boolean(user);
  // Sharing to DMs needs a post id; without one the Messages tab is hidden.
  const messagesAvailable = Boolean(postId);

  // If Messages becomes unavailable (post id absent) or the selected tab is no
  // longer rendered, fall back to a tab that is. Deferred so the effect body
  // never calls setState synchronously.
  useEffect(() => {
    if (!messagesAvailable && activeTab === "messages") {
      const timer = setTimeout(() => setActiveTab("social"), 0);
      return () => clearTimeout(timer);
    }
  }, [activeTab, messagesAvailable]);

  const fetchShareStats = useCallback(async () => {
    if (!isLoggedIn || !postId) {
      // Guests or non-post shares skip database statistics.
      return;
    }
    try {
      setIsLoading(true);
      const response = await fetch(`/api/posts/${postId}/share/stats`, {
        headers: {
          "Content-Type": "application/json",
        },
        method: "GET",
      });

      ensureResponseOk(response, `HTTP error! status: ${response.status}`);

      const data = await response.json();
      clientLog.log("Received share stats:", data);
      if (Array.isArray(data)) {
        setShareStats(data);
      } else {
        clientLog.error("Invalid data format received:", data);
        setShareStats([]);
      }
    } catch (error) {
      clientLog.error("Failed to fetch share stats:", error);
      toast({
        description: "Couldn't load your share stats, try again?",
        title: "Stats Unavailable",
        variant: "destructive",
      });
      setShareStats([]);
    }
    // The catch above never rethrows and the try body has no early returns,
    // so resetting here matches the previous `finally` semantics.
    setIsLoading(false);
  }, [isLoggedIn, postId]);

  useEffect(() => {
    if (isOpen) {
      // Deferred to a microtask so the effect body never calls setState
      // synchronously (fetchShareStats flips isLoading before its first
      // await).
      queueMicrotask(() => {
        fetchShareStats();
      });
    }
  }, [isOpen, fetchShareStats]);

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const trackShare = async (platform: string) => {
    if (!postId) {
      return;
    }
    try {
      const response = await fetch(`/api/posts/${postId}/share`, {
        body: JSON.stringify({ platform }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      ensureResponseOk(response, `HTTP error! status: ${response.status}`);

      const data = await response.json();
      setShareStats((prev) =>
        prev.map((stat) =>
          stat.platform === platform ? { ...stat, shares: data.shares } : stat
        )
      );
    } catch (error) {
      clientLog.error("Failed to track share:", error);
      toast({
        description: "That share didn't get counted, no big deal!",
        title: "Share Not Counted",
        variant: "destructive",
      });
    }
  };

  const trackClick = async (platform: string) => {
    if (!postId) {
      return;
    }
    try {
      const response = await fetch(`/api/posts/${postId}/share/click`, {
        body: JSON.stringify({ platform }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      ensureResponseOk(response, `HTTP error! status: ${response.status}`);

      const data = await response.json();
      setShareStats((prev) =>
        prev.map((stat) =>
          stat.platform === platform ? { ...stat, clicks: data.clicks } : stat
        )
      );
    } catch (error) {
      clientLog.error("Failed to track click:", error);
      toast({
        description: "That click didn't get counted, no big deal!",
        title: "Click Not Counted",
        variant: "destructive",
      });
    }
  };

  const socialShareOptions = [
    {
      color: "#1DA1F2",
      icon: FaTwitter,
      name: "Twitter",
      onClick: async () => {
        await trackShare("twitter");
        window.open(
          `https://twitter.com/intent/tweet?url=${encodeURIComponent(
            postUrl
          )}&text=${encodeURIComponent(title || "Check out this post!")}`,
          "_blank"
        );
        await trackClick("twitter");
      },
    },
    {
      color: "#4267B2",
      icon: FaFacebook,
      name: "Facebook",
      onClick: async () => {
        await trackShare("facebook");
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`,
          "_blank"
        );
        await trackClick("facebook");
      },
    },
    {
      color: "#0077B5",
      icon: FaLinkedin,
      name: "LinkedIn",
      onClick: async () => {
        await trackShare("linkedin");
        window.open(
          `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(postUrl)}`,
          "_blank"
        );
        await trackClick("linkedin");
      },
    },
    {
      color: "#E4405F",
      icon: FaInstagram,
      name: "Instagram",
      // eslint-disable-next-line react/no-unstable-nested-components -- handler contains JSX (toast icon)
      onClick: async () => {
        await trackShare("instagram");
        await navigator.clipboard.writeText(postUrl);
        window.open("https://instagram.com", "_blank");
        toast({
          description: "Paste it anywhere you like",
          icon: <Link2 />,
          title: "Link Copied",
        });
        await trackClick("instagram");
      },
    },
    {
      color: "#E60023",
      icon: FaPinterest,
      name: "Pinterest",
      onClick: async () => {
        await trackShare("pinterest");
        window.open(
          `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(postUrl)}&media=${encodeURIComponent(thumbnail || "")}&description=${encodeURIComponent(description || "")}`,
          "_blank"
        );
        await trackClick("pinterest");
      },
    },
    {
      color: "#FF4500",
      icon: FaReddit,
      name: "Reddit",
      onClick: async () => {
        await trackShare("reddit");
        window.open(
          `https://reddit.com/submit?url=${encodeURIComponent(postUrl)}&title=${encodeURIComponent(title || "")}`,
          "_blank"
        );
        await trackClick("reddit");
      },
    },
    {
      color: "#25D366",
      icon: FaWhatsapp,
      name: "WhatsApp",
      onClick: async () => {
        await trackShare("whatsapp");
        window.open(
          `https://wa.me/?text=${encodeURIComponent(`${title || "Check out this post!"} ${postUrl}`)}`,
          "_blank"
        );
        await trackClick("whatsapp");
      },
    },
    {
      color: "#5865F2",
      icon: DiscordLogoIcon,
      name: "Discord",
      onClick: async () => {
        await trackShare("discord");
        window.open(
          `https://discord.com/channels/@me?message=${encodeURIComponent(
            `${title || "Check out this post!"} ${postUrl}`
          )}`,
          "_blank"
        );
        await trackClick("discord");
      },
    },
    {
      color: "#EA4335",
      icon: Mail,
      name: "Email",
      onClick: async () => {
        await trackShare("email");
        window.open(
          `mailto:?subject=${encodeURIComponent(
            title || "Check out this post!"
          )}&body=${encodeURIComponent(`${description || ""}\n\n${postUrl}`)}`,
          "_blank"
        );
        await trackClick("email");
      },
    },
  ];

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      toast({
        description: "Link copied, paste it anywhere",
        icon: <Link2 />,
        title: "Link Copied",
      });
      await trackShare("copy");
    } catch {
      toast({
        description: "Couldn't copy the link, try again?",
        title: "Copy Failed",
        variant: "destructive",
      });
    }
  };

  const handleThumbnailError = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      e.currentTarget.src = FALLBACK_THUMBNAIL;
    },
    []
  );

  const downloadQrCode = async () => {
    try {
      const svg = document.querySelector(".qr-code svg");
      if (svg) {
        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = document.createElement("img");
        img.addEventListener("load", () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          const pngFile = canvas.toDataURL("image/png");
          const downloadLink = document.createElement("a");
          downloadLink.download = `qr-code-${postId}.png`;
          downloadLink.href = pngFile;
          downloadLink.click();
        });
        img.src = `data:image/svg+xml;base64,${btoa(svgData)}`;
        await trackShare("qr");
        toast({
          description: "QR code saved to your device",
          icon: <QrCode />,
          title: "QR Code Downloaded",
        });
      }
    } catch {
      toast({
        description: "Couldn't download the QR code, try again?",
        title: "Download Failed",
        variant: "destructive",
      });
    }
  };

  const handleOpen = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setIsOpen(true);
    setPopupOpen(true);
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    setPopupOpen(open);
  }, []);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const renderStatsBody = () => {
    if (!isLoggedIn) {
      return (
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <Image
            alt=""
            aria-hidden
            className="h-20 w-auto object-contain"
            draggable={false}
            height={256}
            src={authImage}
            width={256}
          />
          <p className="text-muted-foreground max-w-52 text-sm">
            Log in to see share statistics
          </p>
          <Button
            asChild
            className="h-8 rounded-full px-4 text-xs"
            variant="premium"
          >
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      );
    }
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-4">
          <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      );
    }
    if (shareStats.length > 0) {
      const visibleStats = shareStats.filter(
        (stat) => stat.shares > 0 || stat.clicks > 0
      );
      if (visibleStats.length > 0) {
        return (
          <div className="flex flex-col gap-1.5">
            {visibleStats.map((stat) => (
              <div
                className="border-border/50 flex items-center justify-between rounded-lg border bg-[hsl(var(--background-alt))] px-3 py-2 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]"
                key={stat.platform}
              >
                <span className="font-medium capitalize">{stat.platform}</span>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-600 tabular-nums dark:text-orange-400">
                    {stat.shares} shares
                  </span>
                  <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-600 tabular-nums dark:text-blue-400">
                    {stat.clicks} clicks
                  </span>
                </div>
              </div>
            ))}
          </div>
        );
      }
    }
    return (
      <div className="flex flex-col items-center gap-2.5 py-2 text-center">
        <Image
          alt=""
          aria-hidden
          className="h-24 w-24 object-contain opacity-80"
          draggable={false}
          height={96}
          src={noSearchImage}
          width={96}
        />
        <p className="text-muted-foreground max-w-52 text-sm">No shares yet</p>
      </div>
    );
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <button
        aria-label="Share"
        className={cn(
          "pill-3d-hover group text-muted-foreground inline-flex h-7 w-7 items-center justify-center rounded-full border-0 p-0 active:translate-y-px sm:h-7.5 sm:w-7.5",
          className
        )}
        onClick={handleOpen}
        type="button"
      >
        <Share2 className="size-4 sm:size-4.5" />
      </button>
      <DialogContent
        className="apple-panel w-full max-w-120 gap-4 overflow-hidden rounded-2xl p-0"
        onClick={handleContentClick}
      >
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <Share2 className="h-3.5 w-3.5" />
            </div>
            {dialogTitle}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-1 text-xs">
            {dialogDescription}
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <Tabs
            className="w-full"
            onValueChange={(value) =>
              setActiveTab(value as "social" | "link" | "qr" | "messages")
            }
            value={activeTab}
          >
            <TabsList
              className={cn(
                "border-border/60 mb-4 grid h-auto w-full items-stretch gap-1 rounded-xl border bg-[hsl(var(--background-alt))] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]",
                messagesAvailable ? "grid-cols-4" : "grid-cols-3"
              )}
            >
              <TabsTrigger
                className="rounded-lg py-1.5 text-sm font-medium transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                value="social"
              >
                Social
              </TabsTrigger>
              <TabsTrigger
                className="rounded-lg py-1.5 text-sm font-medium transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                value="link"
              >
                Link
              </TabsTrigger>
              <TabsTrigger
                className="rounded-lg py-1.5 text-xs font-medium transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                value="qr"
              >
                QR Code
              </TabsTrigger>
              {messagesAvailable ? (
                <TabsTrigger
                  className="rounded-lg py-1.5 text-xs font-medium transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                  value="messages"
                >
                  Messages
                </TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent className="mt-0" value="social">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                {thumbnail ? (
                  <div className="border-border/60 relative mb-4 h-32 overflow-hidden rounded-xl border shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
                    <Image
                      alt="Post thumbnail"
                      className="object-cover"
                      fill
                      onError={handleThumbnailError}
                      src={thumbnail || FALLBACK_THUMBNAIL}
                    />
                    <div className="from-background/60 absolute inset-0 bg-linear-to-t to-transparent" />
                  </div>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  {socialShareOptions.map((option) => {
                    const stats = shareStats.find(
                      (stat) => stat.platform === option.name.toLowerCase()
                    );
                    return (
                      <button
                        className="pill-3d-hover group border-border/60 flex flex-col items-center justify-center gap-1.5 rounded-xl border bg-[hsl(var(--background))] p-3.5 text-sm transition-all duration-200 active:translate-y-px"
                        key={option.name}
                        // eslint-disable-next-line react/jsx-handler-names -- handler is defined in the options array
                        onClick={option.onClick}
                        type="button"
                      >
                        <option.icon
                          className="h-6 w-6"
                          style={{ color: option.color }}
                        />
                        <span className="font-medium">{option.name}</span>
                        {stats && (stats.shares > 0 || stats.clicks > 0) ? (
                          <div className="text-muted-foreground text-[11px]">
                            {stats.shares > 0 ? `${stats.shares} shares` : null}
                            {stats.shares > 0 && stats.clicks > 0
                              ? " · "
                              : null}
                            {stats.clicks > 0 ? `${stats.clicks} clicks` : null}
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </TabsContent>

            <TabsContent className="mt-0" value="link">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4"
                initial={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <div className="flex gap-2">
                  <Input
                    className="h-10 flex-1 rounded-xl font-mono text-sm"
                    readOnly
                    value={postUrl}
                  />
                  <Button
                    className={cn(
                      "h-10 rounded-xl bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] hover:from-[#ffa629] hover:to-[#f56a14] active:translate-y-px",
                      copied &&
                        "from-green-500 to-green-600 text-white hover:from-green-500 hover:to-green-600"
                    )}
                    onClick={copyToClipboard}
                    variant="secondary"
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>

                <div className="border-border/60 rounded-xl border bg-[hsl(var(--background))] p-4 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
                  <h4 className="mb-3 text-sm font-medium">Share Statistics</h4>
                  {renderStatsBody()}
                </div>
              </motion.div>
            </TabsContent>

            {messagesAvailable ? (
              <TabsContent className="mt-0" value="messages">
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  initial={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  <MessageIdentityProvider>
                    <MessageSharePicker postId={postId} />
                  </MessageIdentityProvider>
                </motion.div>
              </TabsContent>
            ) : null}

            <TabsContent className="mt-0" value="qr">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="qr-code rounded-xl bg-white p-4 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_2px_6px_rgba(0,0,0,0.08)]">
                    <QRCodeSVG
                      className="rounded-lg"
                      level="H"
                      size={200}
                      value={postUrl}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="pill-3d-hover text-muted-foreground rounded-xl"
                      onClick={downloadQrCode}
                      variant="outline"
                    >
                      <Download className="h-4 w-4" />
                      Download QR Code
                    </Button>
                    <Button
                      className="pill-3d-hover text-muted-foreground rounded-xl"
                      onClick={copyToClipboard}
                      variant="outline"
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      Copy Link
                    </Button>
                  </div>
                  {shareStats.find((stat) => stat.platform === "qr") && (
                    <div className="text-muted-foreground text-center text-sm">
                      {
                        shareStats.find((stat) => stat.platform === "qr")
                          ?.shares
                      }{" "}
                      QR code downloads
                    </div>
                  )}
                </div>
              </motion.div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShareButton;
