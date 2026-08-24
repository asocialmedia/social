"use client";

import { useIsMobile } from "@asm/ui/hooks/use-mobile";
import { Button } from "@asm/ui/shadui/button";
import { Input } from "@asm/ui/shadui/input";
import { Separator } from "@asm/ui/shadui/separator";
import { Sheet, SheetContent } from "@asm/ui/shadui/sheet";
import { Skeleton } from "@asm/ui/shadui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { ViewVerticalIcon } from "@radix-ui/react-icons";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import React from "react";

import { cn } from "../lib/utils";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

// oxlint-disable-next-line no-redeclare -- context idiom: type shares its name with the runtime context
interface SidebarContext {
  isMobile: boolean;
  open: boolean;
  openMobile: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  state: "expanded" | "collapsed";
  toggleSidebar: () => void;
}

const SidebarContext = React.createContext<SidebarContext | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

const SidebarProvider = ({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ref,
  ...props
}: (React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) & { ref?: React.Ref<HTMLDivElement | null> }) => {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const setOpen = React.useCallback(
    (newValue: boolean | ((value: boolean) => boolean)) => {
      const nextOpenState =
        typeof newValue === "function" ? newValue(open) : newValue;
      if (setOpenProp) {
        setOpenProp(nextOpenState);
      } else {
        setOpenState(nextOpenState);
      }

      // This sets the cookie to keep the sidebar state.
      if (typeof window !== "undefined" && "cookieStore" in window) {
        // Use Cookie Store API if available
        window.cookieStore.set({
          // @ts-expect-error: maxAge is not part of the lib.dom CookieStore types
          maxAge: SIDEBAR_COOKIE_MAX_AGE,
          name: SIDEBAR_COOKIE_NAME,
          path: "/",
          value: nextOpenState.toString(),
        });
      }
    },
    [setOpenProp, open]
  );

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(
    () =>
      isMobile
        ? setOpenMobile((prevOpen) => !prevOpen)
        : setOpen((prevOpen) => !prevOpen),
    [isMobile, setOpen]
  );

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContext>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          className={cn(
            "group/sidebar-wrapper has-[[data-variant=inset]]:bg-sidebar flex min-h-svh w-full",
            className
          )}
          ref={ref}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
};
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = ({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ref,
  ...props
}: (React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}) & { ref?: React.Ref<HTMLDivElement | null> }) => {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === "none") {
    return (
      <div
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-[--sidebar-width] flex-col",
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
        <SheetContent
          className="bg-sidebar text-sidebar-foreground w-[--sidebar-width] p-0 [&>button]:hidden"
          data-mobile="true"
          data-sidebar="sidebar"
          side={side}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
        >
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-side={side}
      data-state={state}
      data-variant={variant}
      ref={ref}
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        className={cn(
          "relative h-svh w-[--sidebar-width] bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
            : "group-data-[collapsible=icon]:w-[--sidebar-width-icon]"
        )}
      />
      <div
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-[--sidebar-width] transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
            : "group-data-[collapsible=icon]:w-[--sidebar-width-icon] group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow"
          data-sidebar="sidebar"
        >
          {children}
        </div>
      </div>
    </div>
  );
};
Sidebar.displayName = "Sidebar";

const SidebarTrigger = ({
  className,
  onClick,
  ref,
  ...props
}: React.ComponentProps<typeof Button> & {
  ref?: React.Ref<React.ElementRef<typeof Button> | null>;
}) => {
  const { toggleSidebar } = useSidebar();

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      toggleSidebar();
    },
    [onClick, toggleSidebar]
  );

  return (
    <Button
      className={cn("h-7 w-7", className)}
      data-sidebar="trigger"
      onClick={handleClick}
      ref={ref}
      size="icon"
      variant="ghost"
      {...props}
    >
      <ViewVerticalIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
};
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarRail = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"button"> & {
  ref?: React.Ref<HTMLButtonElement | null>;
}) => {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      aria-label="Toggle Sidebar"
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        "[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:hover:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      data-sidebar="rail"
      onClick={toggleSidebar}
      ref={ref}
      tabIndex={-1}
      title="Toggle Sidebar"
      type="button"
      {...props}
    />
  );
};
SidebarRail.displayName = "SidebarRail";

const SidebarInset = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"main"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <main
    className={cn(
      "bg-background relative flex min-h-svh flex-1 flex-col",
      "peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2",
      className
    )}
    ref={ref}
    {...props}
  />
);
SidebarInset.displayName = "SidebarInset";

const SidebarInput = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof Input> & {
  ref?: React.Ref<React.ElementRef<typeof Input> | null>;
}) => (
  <Input
    className={cn(
      "bg-background focus-visible:ring-sidebar-ring h-8 w-full shadow-none focus-visible:ring-2",
      className
    )}
    data-sidebar="input"
    ref={ref}
    {...props}
  />
);
SidebarInput.displayName = "SidebarInput";

const SidebarHeader = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn("flex flex-col gap-2 p-2", className)}
    data-sidebar="header"
    ref={ref}
    {...props}
  />
);
SidebarHeader.displayName = "SidebarHeader";

const SidebarFooter = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn("flex flex-col gap-2 p-2", className)}
    data-sidebar="footer"
    ref={ref}
    {...props}
  />
);
SidebarFooter.displayName = "SidebarFooter";

const SidebarSeparator = ({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof Separator> & {
  ref?: React.Ref<React.ElementRef<typeof Separator> | null>;
}) => (
  <Separator
    className={cn("bg-sidebar-border mx-2 w-auto", className)}
    data-sidebar="separator"
    ref={ref}
    {...props}
  />
);
SidebarSeparator.displayName = "SidebarSeparator";

const SidebarContent = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn(
      "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
      className
    )}
    data-sidebar="content"
    ref={ref}
    {...props}
  />
);
SidebarContent.displayName = "SidebarContent";

const SidebarGroup = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
    data-sidebar="group"
    ref={ref}
    {...props}
  />
);
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = ({
  className,
  asChild = false,
  ref,
  ...props
}: (React.ComponentProps<"div"> & { asChild?: boolean }) & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      className={cn(
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opa] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      data-sidebar="group-label"
      ref={ref}
      {...props}
    />
  );
};
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarGroupAction = ({
  className,
  asChild = false,
  ref,
  ...props
}: (React.ComponentProps<"button"> & { asChild?: boolean }) & {
  ref?: React.Ref<HTMLButtonElement | null>;
}) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-sidebar="group-action"
      ref={ref}
      {...props}
    />
  );
};
SidebarGroupAction.displayName = "SidebarGroupAction";

const SidebarGroupContent = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn("w-full text-sm", className)}
    data-sidebar="group-content"
    ref={ref}
    {...props}
  />
);
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"ul"> & {
  ref?: React.Ref<HTMLUListElement | null>;
}) => (
  <ul
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    data-sidebar="menu"
    ref={ref}
    {...props}
  />
);
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"li"> & {
  ref?: React.Ref<HTMLLIElement | null>;
}) => (
  <li
    className={cn("group/menu-item relative", className)}
    data-sidebar="menu-item"
    ref={ref}
    {...props}
  />
);
SidebarMenuItem.displayName = "SidebarMenuItem";

const sidebarMenuButtonVariants = cva(
  "peer/menu-button ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-[width,height,padding] group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:font-medium [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 text-sm",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
        sm: "h-7 text-xs",
      },
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background hover:bg-sidebar-accent hover:text-sidebar-accent-foreground shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
    },
  }
);

const SidebarMenuButton = ({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ref,
  ...props
}: (React.ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) & {
  ref?: React.Ref<HTMLButtonElement | null>;
}) => {
  const Comp = asChild ? Slot : "button";
  const { isMobile, state } = useSidebar();

  const button = (
    <Comp
      className={cn(sidebarMenuButtonVariants({ size, variant }), className)}
      data-active={isActive}
      data-sidebar="menu-button"
      data-size={size}
      ref={ref}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  const tooltipContent =
    typeof tooltip === "string" ? { children: tooltip } : tooltip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        align="center"
        hidden={state !== "collapsed" || isMobile}
        side="right"
        {...tooltipContent}
      />
    </Tooltip>
  );
};
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuAction = ({
  className,
  asChild = false,
  showOnHover = false,
  ref,
  ...props
}: (React.ComponentProps<"button"> & {
  asChild?: boolean;
  showOnHover?: boolean;
}) & { ref?: React.Ref<HTMLButtonElement | null> }) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 after:md:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
        className
      )}
      data-sidebar="menu-action"
      ref={ref}
      {...props}
    />
  );
};
SidebarMenuAction.displayName = "SidebarMenuAction";

const SidebarMenuBadge = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"div"> & {
  ref?: React.Ref<HTMLDivElement | null>;
}) => (
  <div
    className={cn(
      "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
      "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
      "peer-data-[size=sm]/menu-button:top-1",
      "peer-data-[size=default]/menu-button:top-1.5",
      "peer-data-[size=lg]/menu-button:top-2.5",
      "group-data-[collapsible=icon]:hidden",
      className
    )}
    data-sidebar="menu-badge"
    ref={ref}
    {...props}
  />
);
SidebarMenuBadge.displayName = "SidebarMenuBadge";

const SidebarMenuSkeleton = ({
  className,
  showIcon = false,
  ref,
  ...props
}: (React.ComponentProps<"div"> & {
  showIcon?: boolean;
}) & { ref?: React.Ref<HTMLDivElement | null> }) => {
  // Stable pseudo-random width between 50 to 90% derived from the instance
  // id: pure during render (no Math.random), yet varied across skeletons.
  const reactId = React.useId();
  const width = React.useMemo(() => {
    let hash = 0;
    for (let i = 0; i < reactId.length; i += 1) {
      hash = (hash * 31 + (reactId.codePointAt(i) ?? 0)) % 100_000;
    }
    return `${(hash % 40) + 50}%`;
  }, [reactId]);

  return (
    <div
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      data-sidebar="menu-skeleton"
      ref={ref}
      {...props}
    >
      {showIcon ? (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      ) : null}
      <Skeleton
        className="h-4 max-w-[--skeleton-width] flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
};
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

const SidebarMenuSub = ({
  className,
  ref,
  ...props
}: React.ComponentProps<"ul"> & {
  ref?: React.Ref<HTMLUListElement | null>;
}) => (
  <ul
    className={cn(
      "border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5",
      "group-data-[collapsible=icon]:hidden",
      className
    )}
    data-sidebar="menu-sub"
    ref={ref}
    {...props}
  />
);
SidebarMenuSub.displayName = "SidebarMenuSub";

const SidebarMenuSubItem = ({
  ref,
  ...props
}: React.ComponentProps<"li"> & {
  ref?: React.Ref<HTMLLIElement | null>;
}) => <li ref={ref} {...props} />;
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

const SidebarMenuSubButton = ({
  asChild = false,
  size = "md",
  isActive,
  className,
  ref,
  ...props
}: (React.ComponentProps<"a"> & {
  asChild?: boolean;
  size?: "sm" | "md";
  isActive?: boolean;
}) & { ref?: React.Ref<HTMLAnchorElement | null> }) => {
  const Comp = asChild ? Slot : "a";

  return (
    <Comp
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-active={isActive}
      data-sidebar="menu-sub-button"
      data-size={size}
      ref={ref}
      {...props}
    />
  );
};
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
