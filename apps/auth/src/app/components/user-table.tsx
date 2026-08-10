/** biome-ignore-all lint/a11y/noSvgWithoutTitle: not needed */
"use client";

import { useDebounce } from "@asm/ui/hooks/use-debounce";
import { useToast } from "@asm/ui/hooks/use-toast";
import { cn } from "@asm/ui/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@asm/ui/shadui/avatar";
import { Button } from "@asm/ui/shadui/button";
import {
  Ban,
  Check,
  ChevronDown,
  FileText,
  Search,
  Shield,
  ShieldOff,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect, useState } from "react";
import { trpc } from "../trpc/client";
import type { ModalAction, User, UserFilters } from "../types/types";

interface UserTableProps {
  filters?: UserFilters;
  hasMore?: boolean;
  onAction: (user: User, action: ModalAction) => void;
  onFiltersChangeAction?: (filters: UserFilters) => void;
  onLoadMoreAction?: () => void;
  onSearchChangeAction: (query: string) => void;
  onSortChangeAction?: (
    sortBy: "createdAt" | "aura" | "username" | "displayName",
    sortOrder: "asc" | "desc"
  ) => void;
  searchQuery: string;
  sortBy?: "createdAt" | "aura" | "username" | "displayName";
  sortOrder?: "asc" | "desc";
  totalCount?: number;
  users: User[];
}

function highlightText(text: string, searchQuery: string): React.ReactNode {
  if (!(searchQuery && text)) {
    return text;
  }

  const regex = new RegExp(
    `(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  const parts = text.split(regex);

  let highlightCounter = 0;
  return parts.map((part) => {
    if (regex.test(part)) {
      highlightCounter++;
      return (
        <mark
          className="rounded bg-yellow-200 px-1 dark:bg-yellow-600"
          key={`highlight-${text}-${searchQuery}-${highlightCounter}`}
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

export default function UserTable({
  users,
  onAction,
  searchQuery,
  onSearchChangeAction,
  totalCount: _totalCount,
  hasMore: _hasMore,
  onLoadMoreAction: _onLoadMore,
  filters: _filters,
  onFiltersChangeAction: _onFiltersChange,
  sortBy: _sortBy,
  sortOrder: _sortOrder,
  onSortChangeAction: _onSortChange,
}: UserTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [entriesPerPage, setEntriesPerPage] = useState(25);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const debouncedSearchQuery = useDebounce(localSearchQuery, 300);

  const { toast } = useToast();
  const utils = trpc.useUtils();
  const banUser = trpc.admin.banUser.useMutation();
  const unbanUser = trpc.admin.unbanUser.useMutation();
  const revokeAll = trpc.admin.revokeUserSessions.useMutation();
  const setRole = trpc.admin.setRole.useMutation();
  const [roleToggleLoading, setRoleToggleLoading] = useState<string | null>(
    null
  );
  const [revokeLoading, setRevokeLoading] = useState<string | null>(null);
  const [banLoading, setBanLoading] = useState<string | null>(null);

  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    onSearchChangeAction(debouncedSearchQuery);
  }, [debouncedSearchQuery, onSearchChangeAction]);

  const toggleRow = (userId: string) => {
    setExpandedRow(expandedRow === userId ? null : userId);
  };

  return (
    <div className="relative h-full">
      <div className="h-full overflow-hidden">
        <div className="custom-scrollbar h-full overflow-x-auto overflow-y-auto">
          <table aria-label="User management table" className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-border border-b bg-muted/50">
                <th className="w-24 px-2 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  ID
                </th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Aura
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Posts
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Sessions
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Following
                </th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Followers
                </th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Joined
                </th>
                <th className="w-16 px-4 py-2 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.slice(0, entriesPerPage).map((user, index) => (
                <React.Fragment key={user.id}>
                  <motion.tr
                    animate={{ opacity: 1 }}
                    className="group transition-colors duration-150 hover:bg-accent/50"
                    initial={{ opacity: 0 }}
                    key={user.id}
                    transition={{ duration: 0.2, delay: index * 0.03 }}
                  >
                    <td className="w-24 px-2 py-2">
                      <span
                        className="block truncate font-mono text-muted-foreground text-xs"
                        title={user.id}
                      >
                        {user.id.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="font-medium text-foreground text-sm">
                        <span
                          className="block max-w-32 truncate"
                          title={user.displayName}
                        >
                          {highlightText(user.displayName, localSearchQuery)}
                        </span>
                        <span
                          className="block max-w-32 truncate font-normal text-muted-foreground text-xs"
                          title={`@${user.username}`}
                        >
                          @{highlightText(user.username, localSearchQuery)}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground text-sm">
                      <span
                        className="block max-w-48 truncate"
                        title={user.email || "No email"}
                      >
                        {highlightText(
                          user.email || "No email",
                          localSearchQuery
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-primary text-sm">
                      {user.aura.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-muted-foreground text-sm">
                      {user.posts.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-muted-foreground text-sm">
                      {user.sessions}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-muted-foreground text-sm">
                      {user.following.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-muted-foreground text-sm">
                      {user.followers.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground text-sm">
                      {new Date(user.joinedDate).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-center">
                      <Button
                        aria-expanded={expandedRow === user.id}
                        aria-label={`Toggle details for ${user.displayName}`}
                        className="h-7 w-7 text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground"
                        onClick={() => toggleRow(user.id)}
                        size="icon"
                        variant="ghost"
                      >
                        <motion.div
                          animate={{
                            rotate: expandedRow === user.id ? 180 : 0,
                          }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </motion.div>
                      </Button>
                    </td>
                  </motion.tr>
                  <AnimatePresence>
                    {expandedRow === user.id && (
                      <motion.tr
                        animate={{ opacity: 1, height: "auto" }}
                        className="bg-muted/30"
                        exit={{ opacity: 0, height: 0 }}
                        initial={{ opacity: 0, height: 0 }}
                        key={`${user.id}-details`}
                        transition={{ duration: 0.2 }}
                      >
                        <td className="px-4 py-4" colSpan={11}>
                          <div className="flex gap-6">
                            <Avatar className="h-24 w-24 border-2 border-border">
                              <AvatarImage
                                alt={user.displayName}
                                src={user.avatarUrl || "/placeholder.svg"}
                              />
                              <AvatarFallback className="bg-primary/10 text-2xl text-primary">
                                {user.displayName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 space-y-3">
                              <div>
                                <h3 className="font-semibold text-foreground text-lg">
                                  {highlightText(
                                    user.displayName,
                                    localSearchQuery
                                  )}
                                </h3>
                                <p className="text-muted-foreground text-sm">
                                  @
                                  {highlightText(
                                    user.username,
                                    localSearchQuery
                                  )}
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="text-muted-foreground">
                                    ID:
                                  </span>{" "}
                                  <span className="font-mono text-foreground text-xs">
                                    {user.id}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Email:
                                  </span>{" "}
                                  <span className="text-foreground">
                                    {highlightText(
                                      user.email || "No email",
                                      localSearchQuery
                                    )}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Role:
                                  </span>{" "}
                                  <span className="text-foreground capitalize">
                                    {user.role}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Email Verified:
                                  </span>{" "}
                                  <span className="text-foreground">
                                    {user.emailVerified ? "Yes" : "No"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Member Since:
                                  </span>{" "}
                                  <span className="text-foreground">
                                    {user.joinedDate}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">
                                    Total Posts:
                                  </span>{" "}
                                  <span className="text-foreground">
                                    {user.posts.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-2 pt-2">
                                <Button
                                  className="border-border hover:bg-accent"
                                  onClick={() => onAction(user, "view")}
                                  size="sm"
                                  variant="outline"
                                >
                                  View Full Profile
                                </Button>
                                <Button
                                  className="border-border hover:bg-accent"
                                  onClick={() => onAction(user, "edit")}
                                  size="sm"
                                  variant="outline"
                                >
                                  Edit User
                                </Button>
                                <Button
                                  className="border-border hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => onAction(user, "update")}
                                  size="sm"
                                  variant="outline"
                                >
                                  Update
                                </Button>
                                <Button
                                  className="border-border hover:bg-accent"
                                  disabled={roleToggleLoading === user.id}
                                  onClick={async () => {
                                    try {
                                      setRoleToggleLoading(user.id);
                                      const newRole =
                                        user.role === "admin"
                                          ? "user"
                                          : "admin";
                                      await setRole.mutateAsync({
                                        userId: user.id,
                                        role: newRole,
                                      });
                                      await utils.admin.getUsers.invalidate();
                                      toast({
                                        title: "Success",
                                        description: `Successfully updated ${user.username}'s role to ${newRole}`,
                                      });
                                    } catch (error) {
                                      toast({
                                        variant: "destructive",
                                        title: "Error",
                                        description: `Failed to update user role: ${error instanceof Error ? error.message : "Unknown error"}`,
                                      });
                                    } finally {
                                      setRoleToggleLoading(null);
                                    }
                                  }}
                                  size="sm"
                                  variant="outline"
                                >
                                  {user.role === "admin" ? (
                                    <span className="inline-flex items-center gap-1">
                                      <ShieldOff className="h-4 w-4" /> Remove
                                      Admin
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1">
                                      <Shield className="h-4 w-4" /> Make Admin
                                    </span>
                                  )}
                                </Button>
                                <Button
                                  className="border-border hover:bg-accent"
                                  disabled
                                  size="sm"
                                  variant="outline"
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <Check className="h-4 w-4" /> Verified
                                  </span>
                                </Button>
                                <Button
                                  className="border-border hover:bg-accent"
                                  disabled={revokeLoading === user.id}
                                  onClick={async () => {
                                    try {
                                      setRevokeLoading(user.id);
                                      await revokeAll.mutateAsync({
                                        userId: user.id,
                                      });
                                      await utils.admin.getUsers.invalidate();
                                      toast({
                                        title: "Success",
                                        description: `Successfully revoked all sessions for ${user.username}`,
                                      });
                                    } catch (error) {
                                      toast({
                                        variant: "destructive",
                                        title: "Error",
                                        description: `Failed to revoke sessions for ${user.username}: ${error instanceof Error ? error.message : "Unknown error"}`,
                                      });
                                    } finally {
                                      setRevokeLoading(null);
                                    }
                                  }}
                                  size="sm"
                                  variant="outline"
                                >
                                  Revoke Sessions
                                </Button>
                                <Button
                                  className="border-border hover:bg-destructive/10 hover:text-destructive"
                                  disabled={banLoading === user.id}
                                  onClick={async () => {
                                    try {
                                      setBanLoading(user.id);
                                      const isBanned = user.banned ?? false;
                                      if (isBanned) {
                                        await unbanUser.mutateAsync({
                                          userId: user.id,
                                        });
                                        await utils.admin.getUsers.invalidate();
                                        toast({
                                          title: "Success",
                                          description: `Successfully unbanned user ${user.username}`,
                                        });
                                      } else {
                                        await banUser.mutateAsync({
                                          userId: user.id,
                                          banReason: "Admin action",
                                        });
                                        await utils.admin.getUsers.invalidate();
                                        toast({
                                          title: "Success",
                                          description: `Successfully banned user ${user.username}`,
                                        });
                                      }
                                    } catch (error) {
                                      toast({
                                        variant: "destructive",
                                        title: "Error",
                                        description: `Failed to ${user.banned ? "unban" : "ban"} user ${user.username}: ${error instanceof Error ? error.message : "Unknown error"}`,
                                      });
                                    } finally {
                                      setBanLoading(null);
                                    }
                                  }}
                                  size="sm"
                                  variant="outline"
                                >
                                  <span className="inline-flex items-center gap-1">
                                    <Ban className="h-4 w-4" />{" "}
                                    {(user.banned ?? false) ? "Unban" : "Ban"}
                                  </span>
                                </Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    )}
                  </AnimatePresence>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="fixed bottom-6 left-6 z-20"
        initial={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {searchExpanded && (
              <motion.input
                animate={{ width: 280, opacity: 1 }}
                autoFocus
                className="h-10 rounded-full border border-border bg-card px-4 text-foreground text-sm shadow-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                exit={{ width: 0, opacity: 0 }}
                initial={{ width: 0, opacity: 0 }}
                onChange={(e) => setLocalSearchQuery(e.target.value)}
                placeholder="Search users..."
                transition={{ duration: 0.2 }}
                type="text"
                value={localSearchQuery}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {!searchExpanded && (
              <>
                <motion.button
                  animate={{ scale: 1, opacity: 1 }}
                  aria-label="Open search"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-all duration-150 hover:bg-primary/90"
                  exit={{ scale: 0, opacity: 0 }}
                  initial={{ scale: 0, opacity: 0 }}
                  onClick={() => setSearchExpanded(true)}
                  transition={{ duration: 0.15 }}
                >
                  <Search className="h-5 w-5" />
                </motion.button>
                <motion.button
                  animate={{ scale: 1, opacity: 1 }}
                  aria-label="View logs"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-all duration-150 hover:bg-accent"
                  exit={{ scale: 0, opacity: 0 }}
                  initial={{ scale: 0, opacity: 0 }}
                  onClick={() => console.log("[v0] Navigate to logs page")}
                  transition={{ duration: 0.15, delay: 0.05 }}
                >
                  <FileText className="h-5 w-5" />
                </motion.button>
              </>
            )}
          </AnimatePresence>
          {searchExpanded && (
            <button
              aria-label="Close search"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive text-white shadow-lg transition-all duration-150 hover:bg-destructive/90"
              onClick={() => {
                if (searchQuery) {
                  onSearchChangeAction("");
                }
                setSearchExpanded(false);
              }}
              type="button"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="fixed right-6 bottom-6 z-20"
        initial={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
          <span className="text-muted-foreground text-xs">Show:</span>
          {[25, 50, 100].map((value) => (
            <button
              className={cn(
                "rounded-full px-3 py-1 font-medium text-xs transition-all duration-150",
                entriesPerPage === value
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              key={value}
              onClick={() => setEntriesPerPage(value)}
              type="button"
            >
              {value}
            </button>
          ))}
          <span className="text-muted-foreground text-xs">entries</span>
        </div>
      </motion.div>
    </div>
  );
}
