"use client";

import Link from "next/link";
import { NavigationItem } from "@/types";
import { Button } from "@/components/ui/button";
import * as Icons from "lucide-react";

interface NavigationProps {
  items: readonly NavigationItem[];
  className?: string;
}

export function Navigation({ items, className = "" }: NavigationProps) {
  return (
    <nav className={`flex items-center space-x-1 ${className}`}>
      {items.map((item) => {
        // Dynamically get the icon component
        const IconComponent = item.icon ? (Icons as any)[item.icon] : null;
        
        return (
          <Button key={item.href} variant="ghost" size="sm" asChild>
            <Link href={item.href} className="flex items-center space-x-2">
              {IconComponent && <IconComponent className="h-4 w-4" />}
              <span>{item.name}</span>
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
