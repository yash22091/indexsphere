"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronDown, ChevronsUpDown, LogOut, Monitor, Moon, Sun, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark, BrandName, StatusDot } from "@/components/app";
import { NAV_GROUPS, findNavItem } from "@/constants/navigation";
import { useConnection } from "@/contexts/connection-context";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const COLLAPSE_KEY = "indexsphere.sidebar.collapsed";

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

interface ChStatus { connected: boolean; url?: string; version?: string }

function hostOf(url?: string) {
  if (!url) return "";
  try { return new URL(url).host; } catch { return url; }
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isConnected, connectionConfig, disconnect } = useConnection();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const isAdmin = !!user?.permissions?.includes("admin");
  const role = isAdmin ? "Admin" : user?.permissions?.includes("user") ? "Operator" : "Read-only";
  const active = findNavItem(pathname);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => { setCollapsed(readCollapsed()); }, []);
  const toggleGroup = (id: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  // ClickHouse session status (separate from the search-cluster connection)
  const [ch, setCh] = useState<ChStatus>({ connected: false });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clickhouse/connect")
      .then(r => (r.ok ? r.json() : { connected: false }))
      .then(d => { if (!cancelled) setCh(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  const signOut = () => {
    logout();
    window.location.href = "/auth";
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 lg:z-20",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link href="/overview" className="flex items-center gap-2.5" onClick={onClose}>
            <BrandMark className="h-7 w-7" />
            <div className="leading-tight">
              <BrandName className="text-sm" />
              <div className="text-[11px] text-muted-foreground">Operations console</div>
            </div>
          </Link>
          <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Connections */}
        <div className="mx-3 mb-2 space-y-0.5 rounded-lg border bg-background p-1.5 text-xs">
          <ConnectionRow
            label="Search cluster"
            connected={isConnected}
            detail={isConnected ? (connectionConfig?.name || hostOf(connectionConfig?.url)) : "Not connected"}
            href={isConnected ? "/overview" : "/connections"}
            onDisconnect={isConnected ? () => { disconnect(); router.push("/connections"); } : undefined}
            onNavigate={onClose}
          />
          <ConnectionRow
            label="ClickHouse"
            connected={ch.connected}
            detail={ch.connected ? hostOf(ch.url) : "Not connected"}
            href="/clickhouse"
            onDisconnect={ch.connected ? () => {
              fetch("/api/clickhouse/connect", { method: "DELETE" }).finally(() => { setCh({ connected: false }); router.push("/clickhouse"); });
            } : undefined}
            onNavigate={onClose}
          />
        </div>

        {/* Navigation */}
        <ScrollArea className="min-h-0 flex-1 px-3">
          <nav className="space-y-4 py-2">
            {NAV_GROUPS.map(group => {
              const items = group.items.filter(i => !i.adminOnly || isAdmin);
              if (!items.length) return null;
              const isCollapsed = collapsed[group.id] && active?.group.id !== group.id;
              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    aria-expanded={!isCollapsed}
                  >
                    {group.label}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isCollapsed && "-rotate-90")} />
                  </button>
                  {!isCollapsed && (
                    <ul className="mt-1 space-y-0.5">
                      {items.map(item => {
                        const isActive = active?.item.href === item.href;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={onClose}
                              aria-current={isActive ? "page" : undefined}
                              className={cn(
                                "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors",
                                isActive
                                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                              )}
                            >
                              <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-foreground" : "text-muted-foreground")} />
                              <span className="truncate">{item.title}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        </ScrollArea>

        {/* User */}
        {user && (
          <div className="border-t p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-sidebar-accent">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase">
                    {user.username.slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-medium">{user.username}</span>
                    <span className="block text-xs text-muted-foreground">{role}</span>
                  </span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{user.username}</div>
                  <div className="text-xs text-muted-foreground">{role}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light"><Sun className="mr-2 h-4 w-4" />Light</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark"><Moon className="mr-2 h-4 w-4" />Dark</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system"><Monitor className="mr-2 h-4 w-4" />System</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </aside>
    </>
  );
}

function ConnectionRow({ label, connected, detail, href, onDisconnect, onNavigate }: {
  label: string;
  connected: boolean;
  detail: string;
  href: string;
  onDisconnect?: () => void;
  onNavigate: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
      <StatusDot status={connected ? "green" : undefined} />
      <Link href={href} onClick={onNavigate} className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{label}</div>
        <div className="truncate text-muted-foreground">{detail}</div>
      </Link>
      {onDisconnect && (
        <button
          type="button"
          onClick={onDisconnect}
          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
          title={`Disconnect ${label}`}
          aria-label={`Disconnect ${label}`}
        >
          <Unplug className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
