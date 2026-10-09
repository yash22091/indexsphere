"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/organisms/header";
import { Sidebar } from "@/components/organisms/sidebar";
import { cn } from "@/lib/utils";

const DESKTOP = 1024;

export function MainLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Open on desktop, closed (overlay) on smaller screens
  useEffect(() => {
    const apply = () => setSidebarOpen(window.innerWidth >= DESKTOP);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const closeOnMobile = () => {
    if (window.innerWidth < DESKTOP) setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <Sidebar open={sidebarOpen} onClose={closeOnMobile} />
      <div className={cn("flex min-h-screen flex-col transition-[margin] duration-200", sidebarOpen ? "lg:ml-64" : "lg:ml-0")}>
        <Header onMenuClick={() => setSidebarOpen(o => !o)} />
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
