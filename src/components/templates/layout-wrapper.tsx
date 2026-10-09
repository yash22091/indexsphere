"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { MainLayout } from "./main-layout";

interface LayoutWrapperProps {
  children: React.ReactNode;
}

const isPublic = (pathname: string) => pathname === "/auth" || pathname.startsWith("/auth/");

export function LayoutWrapper({ children }: LayoutWrapperProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  // Middleware can only check that a cookie exists. If the server says the
  // session is not valid (signed out elsewhere, expired, server restarted),
  // send the user to sign in instead of showing an empty app.
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic(pathname)) {
      router.replace(`/auth?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isAuthenticated && !isPublic(pathname)) {
    return <MainLayout>{children}</MainLayout>;
  }
  if (!isLoading && !isAuthenticated && !isPublic(pathname)) {
    return null; // redirecting
  }

  return <main>{children}</main>;
}
