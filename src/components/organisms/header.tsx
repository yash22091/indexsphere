"use client";

import { Logo } from "@/components/atoms/logo";
import { ThemeToggle } from "@/components/atoms/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { useConnection } from "@/contexts/connection-context";
import { LogOut, User, Menu, Unplug, Wifi } from "lucide-react";

interface HeaderProps {
  onMenuClick?: () => void;
  sidebarOpen?: boolean;
  title?: string;
}

export function Header({ onMenuClick, sidebarOpen = false, title }: HeaderProps) {
  const { user, logout } = useAuth();
  const { isConnected, disconnect, connectionConfig } = useConnection();

  const handleLogout = () => {
    logout();
    window.location.href = "/auth";
  };

  const handleDisconnect = () => {
    disconnect();
    window.location.href = "/connect";
  };

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onMenuClick}
            className="p-2"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="hidden sm:block">
            {title ? (
              <h1 className="text-lg font-semibold">{title}</h1>
            ) : (
              <Logo />
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Always show auth controls if we have any user or connection */}
          <div className="flex items-center space-x-2">
            {user && (
              <div className="hidden lg:flex items-center space-x-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{user.username}</span>
                <span className="text-xs bg-secondary px-2 py-1 rounded">
                  {user.authMethod.toUpperCase()}
                </span>
              </div>
            )}
            
            {/* Connection Status & Disconnect Button */}
            {isConnected && connectionConfig && (
              <div className="flex items-center space-x-2">
                <div className="hidden xl:flex items-center space-x-2 text-sm text-muted-foreground">
                  <Wifi className="h-4 w-4 text-green-500" />
                  <span className="text-xs">
                    {connectionConfig.name || new URL(connectionConfig.url).host}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  className="text-muted-foreground hover:text-red-500"
                  title="Disconnect from cluster"
                >
                  <Unplug className="h-4 w-4" />
                  <span className="ml-1 hidden md:inline text-xs">Disconnect</span>
                </Button>
              </div>
            )}
            
            {/* Logout Button - Always show if user exists */}
            {user && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-red-500"
                title="Logout from application"
              >
                <LogOut className="h-4 w-4" />
                <span className="ml-1 hidden md:inline text-xs">Logout</span>
              </Button>
            )}
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
