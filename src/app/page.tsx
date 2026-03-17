"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useConnection } from "@/contexts/connection-context";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isConnected } = useConnection();

  useEffect(() => {
    if (authLoading) return; // Wait for auth to load

    if (!isAuthenticated) {
      router.replace("/auth");
      return;
    }

    // If authenticated, check connection status
    if (isConnected) {
      router.replace("/overview");
    } else {
      router.replace("/connect");
    }
  }, [isAuthenticated, isConnected, authLoading, router]);

  // Show loading while determining where to redirect
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}
