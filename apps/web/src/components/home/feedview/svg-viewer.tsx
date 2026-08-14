// oxlint-disable react-compiler -- the nested Controls helper needs viewer state and the React Compiler rules reject it

import { Button } from "@asm/ui/shadui/button";
import { Slider } from "@asm/ui/shadui/slider";
import {
  Download,
  FlipHorizontal,
  FlipVertical,
  Maximize2,
  Menu,
  Minimize2,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { cn } from "@/lib/utils";

interface SvgViewerProps {
  className?: string;
  onDownload?: () => void;
  onLoad?: () => void;
  url: string;
}

export const SVGViewer = ({
  url,
  className,
  onLoad,
  onDownload,
}: SvgViewerProps) => {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  // eslint-disable-next-line react/hook-use-state -- follows the [thing, setThing] pattern for a flag
  const [_dimensions, setDimensions] = useState({ height: 0, width: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");
  // eslint-disable-next-line react/hook-use-state -- follows the [thing, setThing] pattern for a flag
  const [showControls, setShowControls] = useState(!isMobile);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    await (isFullscreen
      ? document.exitFullscreen()
      : containerRef.current?.requestFullscreen());
  }, [isFullscreen]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          height: rect.height,
          width: rect.width,
        });
      }
    };

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);
    updateDimensions();

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    },
    [position]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [dragStart, isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resetView = useCallback(() => {
    setScale(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1) {
        setIsDragging(true);
        setDragStart({
          x: e.touches[0].clientX - position.x,
          y: e.touches[0].clientY - position.y,
        });
      }
    },
    [position]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isDragging && e.touches.length === 1) {
        setPosition({
          x: e.touches[0].clientX - dragStart.x,
          y: e.touches[0].clientY - dragStart.y,
        });
      }
    },
    [dragStart, isDragging]
  );

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
    }
  }, []);

  const handleFrameError = useCallback(() => {
    setHasError(true);
    onLoad?.();
  }, [onLoad]);

  const handleFrameLoad = useCallback(() => {
    setHasError(false);
    onLoad?.();
  }, [onLoad]);

  const handleToggleControls = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.1, 0.1));
  }, []);
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.1, 5));
  }, []);
  const handleScaleChange = useCallback((values: number[]) => {
    const [value] = values;
    if (value !== undefined) {
      setScale(value);
    }
  }, []);
  const handleRotateLeft = useCallback(() => {
    setRotation((prev) => prev - 90);
  }, []);
  const handleRotateRight = useCallback(() => {
    setRotation((prev) => prev + 90);
  }, []);
  const handleFlipX = useCallback(() => {
    setFlipX((prev) => !prev);
  }, []);
  const handleFlipY = useCallback(() => {
    setFlipY((prev) => !prev);
  }, []);

  // eslint-disable-next-line react/no-unstable-nested-components -- Controls uses parent state and is tightly coupled
  const Controls = () => {
    let controlsClassName: string;
    if (!isMobile) {
      controlsClassName = "absolute top-4 right-4";
    } else if (showControls) {
      controlsClassName =
        "fixed inset-x-0 bottom-0 mx-4 mb-4 transition-transform duration-300";
    } else {
      controlsClassName =
        "fixed inset-x-0 bottom-0 mx-4 mb-4 translate-y-full transition-transform duration-300";
    }

    return (
      <div
        className={cn(
          "bg-background/80 z-50 flex flex-col gap-4 rounded-lg p-4 backdrop-blur-sm",
          controlsClassName
        )}
      >
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              className="bg-background/50 hover:bg-background/80"
              onClick={handleZoomOut}
              size={isMobile ? "sm" : "icon"}
              variant="secondary"
            >
              <ZoomOut className={cn("h-4 w-4", isMobile && "mr-2")} />
              {isMobile && "Zoom Out"}
            </Button>
            <Button
              className="bg-background/50 hover:bg-background/80"
              onClick={handleZoomIn}
              size={isMobile ? "sm" : "icon"}
              variant="secondary"
            >
              <ZoomIn className={cn("h-4 w-4", isMobile && "mr-2")} />
              {isMobile && "Zoom In"}
            </Button>
          </div>
          <Slider
            className={isMobile ? "w-full" : "w-32"}
            max={5}
            min={0.1}
            onValueChange={handleScaleChange}
            step={0.1}
            value={[scale]}
          />
        </div>

        <div className={cn("flex gap-2", isMobile && "flex-wrap")}>
          <Button
            className="bg-background/50 hover:bg-background/80"
            onClick={handleRotateLeft}
            size={isMobile ? "sm" : "icon"}
            variant="secondary"
          >
            <RotateCcw className={cn("h-4 w-4", isMobile && "mr-2")} />
            {isMobile && "Rotate Left"}
          </Button>
          <Button
            className="bg-background/50 hover:bg-background/80"
            onClick={handleRotateRight}
            size={isMobile ? "sm" : "icon"}
            variant="secondary"
          >
            <RotateCw className={cn("h-4 w-4", isMobile && "mr-2")} />
            {isMobile && "Rotate Right"}
          </Button>
          <Button
            className={cn(
              "bg-background/50 hover:bg-background/80",
              flipX && "bg-primary/20"
            )}
            onClick={handleFlipX}
            size={isMobile ? "sm" : "icon"}
            variant="secondary"
          >
            <FlipHorizontal className={cn("h-4 w-4", isMobile && "mr-2")} />
            {isMobile && "Flip H"}
          </Button>
          <Button
            className={cn(
              "bg-background/50 hover:bg-background/80",
              flipY && "bg-primary/20"
            )}
            onClick={handleFlipY}
            size={isMobile ? "sm" : "icon"}
            variant="secondary"
          >
            <FlipVertical className={cn("h-4 w-4", isMobile && "mr-2")} />
            {isMobile && "Flip V"}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            className="bg-background/50 hover:bg-background/80"
            onClick={toggleFullscreen}
            size={isMobile ? "sm" : "icon"}
            variant="secondary"
          >
            {isFullscreen ? (
              <Minimize2 className={cn("h-4 w-4", isMobile && "mr-2")} />
            ) : (
              <Maximize2 className={cn("h-4 w-4", isMobile && "mr-2")} />
            )}
            {isMobile && (isFullscreen ? "Exit Fullscreen" : "Fullscreen")}
          </Button>
          <Button
            className="bg-background/50 hover:bg-background/80"
            onClick={resetView}
            size={isMobile ? "sm" : "icon"}
            variant="secondary"
          >
            <svg
              className={cn("h-4 w-4", isMobile && "mr-2")}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M4 4v5h5M4 20v-5h5M20 4v5h-5M20 20v-5h-5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            {isMobile && "Reset"}
          </Button>
          {onDownload ? (
            <Button
              className="bg-background/50 hover:bg-background/80"
              onClick={onDownload}
              size={isMobile ? "sm" : "icon"}
              variant="secondary"
            >
              <Download className={cn("h-4 w-4", isMobile && "mr-2")} />
              {isMobile && "Download"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center",
        className
      )}
      ref={containerRef}
      style={{ minHeight: "50vh" }}
    >
      {isMobile && (
        <Button
          className="bg-background/50 absolute top-4 right-4 z-50"
          onClick={handleToggleControls}
          size="icon"
          variant="ghost"
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}

      <Controls />

      <div
        className="relative h-full w-full flex-1 overflow-hidden"
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- div with role=application is the interactive pan/zoom surface */}
        <div
          aria-label="Interactive SVG viewer - drag to pan, pinch to zoom"
          className="focus-visible:ring-primary cursor-move focus:outline-none focus-visible:ring-2"
          onKeyDown={handleKeyDown}
          onMouseDown={handleMouseDown}
          onMouseLeave={handleMouseUp}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
          role="application"
          style={{
            alignItems: "center",
            display: "flex",
            height: "100%",
            justifyContent: "center",
            width: "100%",
          }}
        >
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- iframe needs load/error handlers */}
          <iframe
            className="h-full w-full"
            onError={handleFrameError}
            onLoad={handleFrameLoad}
            ref={iframeRef}
            sandbox="allow-scripts"
            src={url}
            style={{
              border: "none",
              maxHeight: "100%",
              maxWidth: "100%",
              objectFit: "contain",
              transform: `
                translate(${position.x}px, ${position.y}px)
                scale(${scale})
                rotate(${rotation}deg)
                scaleX(${flipX ? -1 : 1})
                scaleY(${flipY ? -1 : 1})
              `,
              transformOrigin: "center center",
              transition: isDragging ? "none" : "transform 0.2s ease-in-out",
            }}
            title="SVG Viewer"
          />
        </div>
      </div>

      {hasError ? (
        <div className="bg-background/50 absolute inset-0 flex items-center justify-center">
          <p className="text-destructive">Failed to load SVG file</p>
        </div>
      ) : null}

      <div className="bg-background/80 absolute bottom-4 left-4 rounded-sm px-2 py-1 text-sm">
        {(scale * 100).toFixed(0)}%
      </div>
    </div>
  );
};
