"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { MainLayout } from "./main-layout";

interface LayoutWrapperProps {
  children: React.ReactNode;
}

export function LayoutWrapper({ children }: LayoutWrapperProps) {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();
  
  // Only use the main layout with sidebar for authenticated users
  // and not on the auth page
  const useMainLayout = isAuthenticated && pathname !== "/auth";

  if (useMainLayout) {
    return <MainLayout>{children}</MainLayout>;
  }

  return (
    <main>
      {children}
    </main>
  );
}
