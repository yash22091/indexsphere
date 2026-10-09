"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { PanelLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { findNavItem } from "@/constants/navigation";
import { EngineTag, EngineTags } from "@/components/app";
import { CommandMenu } from "./command-menu";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const current = findNavItem(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Button variant="ghost" size="icon" className="h-8 w-8 -ml-1" onClick={onMenuClick} aria-label="Toggle sidebar">
        <PanelLeft className="h-4 w-4" />
      </Button>
      <Separator orientation="vertical" className="mr-1 h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          {current ? (
            <>
              <BreadcrumbItem className="hidden md:block text-muted-foreground">{current.group.label}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem className="min-w-0 gap-2">
                {current.group.engine && <EngineTag engine={current.group.engine} solid />}
                <BreadcrumbPage className="truncate">{current.item.title}</BreadcrumbPage>
                <EngineTags engines={current.item.engines} flow={current.item.flow} />
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem><BreadcrumbPage>IndexSphere</BreadcrumbPage></BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto">
        <Button
          variant="outline"
          className="h-8 w-9 justify-start gap-2 px-2 text-muted-foreground sm:w-56 sm:px-3"
          onClick={() => setPaletteOpen(true)}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden text-sm font-normal sm:inline">Search…</span>
          <kbd className="pointer-events-none ml-auto hidden select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium sm:flex">
            ⌘K
          </kbd>
        </Button>
      </div>
      <CommandMenu open={paletteOpen} onOpenChange={setPaletteOpen} />
    </header>
  );
}
