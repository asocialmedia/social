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
import { toast } from "@/lib/gooey-toast";
import { setPopupOpen } from "@/lib/popup-tracker";
import { cn } from "@/lib/utils";

const FALLBACK_THUMBNAIL = "/fallback.png";

interface ShareButtonProps {
  description?: string;
  postId: string;
  thumbnail?: string;
  title?: string;
}

interface ShareStats {
  clicks: number;
  platform: string;
  shares: number;
}

const ShareButton = ({
  postId,
  title,
  thumbnail,
  description,
}: ShareButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("social");
  const [shareStats, setShareStats] = useState<ShareStats[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const baseUrl = typeof window === "undefined" ? "" : window.location.origin;
  const postUrl = `${baseUrl}/posts/${postId}`;

  const fetchShareStats = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/posts/${postId}/share/stats`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

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
        variant: "destructive",
        title: "Stats Unavailable",
        description: "Couldn't load your share stats, try again?",
      });
      setShareStats([]);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (isOpen) {
      fetchShareStats();
    }
  }, [isOpen, fetchShareStats]);

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const trackShare = async (platform: string) => {
    try {
      const response = await fetch(`/api/posts/${postId}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ platform }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setShareStats((prev) =>
        prev.map((stat) =>
          stat.platform === platform ? { ...stat, shares: data.shares } : stat
        )
      );
    } catch (error) {
      clientLog.error("Failed to track share:", error);
      toast({
        variant: "destructive",
        title: "Share Not Counted",
        description: "That share didn't get counted, no big deal!",
      });
    }
  };

  const trackClick = async (platform: string) => {
    try {
      const response = await fetch(`/api/posts/${postId}/share/click`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ platform }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setShareStats((prev) =>
        prev.map((stat) =>
          stat.platform === platform ? { ...stat, clicks: data.clicks } : stat
        )
      );
    } catch (error) {
      clientLog.error("Failed to track click:", error);
      toast({
        variant: "destructive",
        title: "Click Not Counted",
        description: "That click didn't get counted, no big deal!",
      });
    }
  };

  const socialShareOptions = [
    {
      name: "Twitter",
      icon: FaTwitter,
      color: "#1DA1F2",
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
      name: "Facebook",
      icon: FaFacebook,
      color: "#4267B2",
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
      name: "LinkedIn",
      icon: FaLinkedin,
      color: "#0077B5",
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
      name: "Instagram",
      icon: FaInstagram,
      color: "#E4405F",
      onClick: async () => {
        await trackShare("instagram");
        await navigator.clipboard.writeText(postUrl);
        window.open("https://instagram.com", "_blank");
        toast({
          title: "Link Copied",
          description: "Paste it anywhere you like",
          icon: <Link2 />,
        });
        await trackClick("instagram");
      },
    },
    {
      name: "Pinterest",
      icon: FaPinterest,
      color: "#E60023",
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
      name: "Reddit",
      icon: FaReddit,
      color: "#FF4500",
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
      name: "WhatsApp",
      icon: FaWhatsapp,
      color: "#25D366",
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
      name: "Discord",
      icon: DiscordLogoIcon,
      color: "#5865F2",
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
      name: "Email",
      icon: Mail,
      color: "#EA4335",
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
        title: "Link Copied",
        description: "Link copied, paste it anywhere",
        icon: <Link2 />,
      });
      await trackShare("copy");
    } catch {
      toast({
        variant: "destructive",
        title: "Copy Failed",
        description: "Couldn't copy the link, try again?",
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
        // biome-ignore lint/suspicious/noExplicitAny: <img> is not in lib.dom.d.ts
        const img = new (Image as any)();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          const pngFile = canvas.toDataURL("image/png");
          const downloadLink = document.createElement("a");
          downloadLink.download = `qr-code-${postId}.png`;
          downloadLink.href = pngFile;
          downloadLink.click();
        };
        img.src = `data:image/svg+xml;base64,${btoa(svgData)}`;
        await trackShare("qr");
        toast({
          title: "QR Code Downloaded",
          description: "QR code saved to your device",
          icon: <QrCode />,
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: "Couldn't download the QR code, try again?",
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
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      );
    }
    if (shareStats.length > 0) {
      return (
        <div className="flex flex-col gap-1.5">
          {shareStats
            .filter((stat) => stat.shares > 0 || stat.clicks > 0)
            .map((stat) => (
              <div
                className="flex items-center justify-between rounded-lg border border-border/50 bg-[hsl(var(--background-alt))] px-3 py-2 text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)]"
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
    return (
      <div className="py-2 text-center text-muted-foreground text-sm">
        No shares yet
      </div>
    );
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <button
        aria-label="Share"
        className="pill-3d-hover group inline-flex h-8 items-center justify-center rounded-full border-0 px-2 font-medium text-muted-foreground text-sm active:translate-y-px"
        onClick={handleOpen}
        type="button"
      >
        <Share2 className="h-5 w-5" />
      </button>
      <DialogContent
        className="apple-panel w-full max-w-120 gap-4 overflow-hidden p-0 sm:rounded-2xl"
        onClick={handleContentClick}
      >
        <div className="border-border/60 border-b px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2 font-semibold text-base">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
              <Share2 className="h-3.5 w-3.5" />
            </div>
            Share Post
          </DialogTitle>
          <DialogDescription className="mt-1 text-muted-foreground text-xs">
            Share this post with your network
          </DialogDescription>
        </div>

        <div className="px-5 pb-5">
          <Tabs
            className="w-full"
            onValueChange={setActiveTab}
            value={activeTab}
          >
            <TabsList className="mb-4 grid h-auto w-full grid-cols-3 items-stretch gap-1 rounded-xl border border-border/60 bg-[hsl(var(--background-alt))] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
              <TabsTrigger
                className="rounded-lg py-1.5 font-medium text-sm transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                value="social"
              >
                Social
              </TabsTrigger>
              <TabsTrigger
                className="rounded-lg py-1.5 font-medium text-sm transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                value="link"
              >
                Link
              </TabsTrigger>
              <TabsTrigger
                className="rounded-lg py-1.5 font-medium text-sm transition-all duration-200 data-[state=active]:bg-linear-to-b data-[state=active]:from-[#ff9500] data-[state=active]:to-[#e65500] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]"
                value="qr"
              >
                QR Code
              </TabsTrigger>
            </TabsList>

            <TabsContent className="mt-0" value="social">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                initial={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                {thumbnail ? (
                  <div className="relative mb-4 h-32 overflow-hidden rounded-xl border border-border/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
                    <Image
                      alt="Post thumbnail"
                      className="object-cover"
                      fill
                      onError={handleThumbnailError}
                      src={thumbnail || FALLBACK_THUMBNAIL}
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-background/60 to-transparent" />
                  </div>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  {socialShareOptions.map((option) => {
                    const stats = shareStats.find(
                      (stat) => stat.platform === option.name.toLowerCase()
                    );
                    return (
                      <button
                        className="pill-3d-hover group flex flex-col items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-[hsl(var(--background))] p-3.5 text-sm transition-all duration-200 active:translate-y-px"
                        key={option.name}
                        onClick={option.onClick}
                        type="button"
                      >
                        <option.icon
                          className="h-6 w-6"
                          style={{ color: option.color }}
                        />
                        <span className="font-medium">{option.name}</span>
                        {stats && (stats.shares > 0 || stats.clicks > 0) ? (
                          <div className="text-[11px] text-muted-foreground">
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

                <div className="rounded-xl border border-border/60 bg-[hsl(var(--background))] p-4 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]">
                  <h4 className="mb-3 font-medium text-sm">Share Statistics</h4>
                  {renderStatsBody()}
                </div>
              </motion.div>
            </TabsContent>

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
                      className="pill-3d-hover rounded-xl text-muted-foreground"
                      onClick={downloadQrCode}
                      variant="outline"
                    >
                      <Download className="h-4 w-4" />
                      Download QR Code
                    </Button>
                    <Button
                      className="pill-3d-hover rounded-xl text-muted-foreground"
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
                    <div className="text-center text-muted-foreground text-sm">
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
