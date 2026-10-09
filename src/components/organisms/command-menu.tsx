"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Moon, Sun } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { NAV_GROUPS } from "@/constants/navigation";
import { EngineTags } from "@/components/app";
import { useAuth } from "@/contexts/auth-context";

/** ⌘K / Ctrl+K palette: jump to any page, switch theme, sign out. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { user, logout } = useAuth();
  const isAdmin = !!user?.permissions?.includes("admin");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void | Promise<void>) => {
    onOpenChange(false);
    void fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Go to…" description="Search pages and actions">
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {NAV_GROUPS.map(group => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.filter(i => !i.adminOnly || isAdmin).map(item => (
              <CommandItem
                key={item.href}
                value={`${group.label} ${item.title} ${item.keywords ?? ""}`}
                onSelect={() => run(() => router.push(item.href))}
              >
                <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                {item.title}
                <span className="ml-auto">
                  <EngineTags engines={item.engines ?? (group.engine ? [group.engine] : undefined)} flow={item.flow} />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}><Sun className="mr-2 h-4 w-4" />Light theme</CommandItem>
          <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}><Moon className="mr-2 h-4 w-4" />Dark theme</CommandItem>
          <CommandItem value="sign out logout" onSelect={() => run(async () => { await logout(); window.location.href = "/auth"; })}>
            <LogOut className="mr-2 h-4 w-4" />Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
