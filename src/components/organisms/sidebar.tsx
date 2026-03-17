"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { NAVIGATION } from "@/constants/brand";
import { useConnection } from "@/contexts/connection-context";
import { useAuth } from "@/contexts/auth-context";
import * as Icons from "lucide-react";
import { X } from "lucide-react";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { isConnected } = useConnection();
  const { user } = useAuth();

  // Check if user has admin permissions
  const hasAdminAccess = user?.permissions?.includes('admin') || false;

  // Filter navigation items based on user role
  const filterNavItems = (items: readonly any[]) => {
    return items.filter(item => {
      // Admin-only routes
      if (item.href === '/user-management' || item.href === '/auth-config') {
        return hasAdminAccess;
      }
      // All other routes are accessible to authenticated users
      return true;
    });
  };

  const NavigationSection = ({ title, items, className = "" }: { 
    title: string; 
    items: readonly any[]; 
    className?: string;
  }) => (
    <div className={className}>
      <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        {title}
      </h3>
      <div className="space-y-0.5">
        {items.map((item) => {
          const IconComponent = item.icon ? (Icons as any)[item.icon] : null;
          const isActive = pathname === item.href;
          
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <Button
                variant={isActive ? "secondary" : "ghost"}
                className={`w-full justify-start h-8 px-3 text-sm ${
                  isActive ? "bg-secondary text-secondary-foreground" : ""
                }`}
              >
                {IconComponent && <IconComponent className="h-4 w-4 mr-2" />}
                <span className="truncate">{item.name}</span>
              </Button>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden" 
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 z-20 h-screen w-64 bg-background border-r transform transition-transform duration-200 ease-in-out flex flex-col
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between px-3 py-3 border-b flex-shrink-0">
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground font-bold text-xs">I</span>
              </div>
              <span className="font-bold text-base">Indexsphere</span>
            </div>
            {isConnected && (
              <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs px-1.5 py-0.5">
                Connected
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="lg:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2 py-3">
          <div className="space-y-3">
            <NavigationSection title="Main" items={filterNavItems(NAVIGATION.main)} />
            <Separator className="mx-2" />
            <NavigationSection title="Operations" items={filterNavItems(NAVIGATION.secondary)} />
            <Separator className="mx-2" />
            <NavigationSection title="Advanced" items={filterNavItems(NAVIGATION.advanced)} />
          </div>
        </ScrollArea>

        {/* Connection Status */}
        <div className="px-3 py-2 border-t flex-shrink-0">
          <div className="flex items-center space-x-2 text-xs">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-muted-foreground">
              {isConnected ? 'Cluster Connected' : 'Not Connected'}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
