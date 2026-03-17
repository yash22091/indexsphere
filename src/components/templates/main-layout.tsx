"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Header } from "@/components/organisms/header";
import { Sidebar } from "@/components/organisms/sidebar";
import { NAVIGATION } from "@/constants/brand";

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true); // Default to open on desktop
  const pathname = usePathname();

  // Get page title based on current route
  const getPageTitle = (pathname: string): string | undefined => {
    // Find the current page in navigation
    const allNavItems = [
      ...NAVIGATION.main,
      ...NAVIGATION.secondary,
      ...NAVIGATION.advanced
    ];
    
    const currentPage = allNavItems.find(item => item.href === pathname);
    return currentPage?.name;
  };

  const pageTitle = getPageTitle(pathname);

  // Auto-responsive behavior for sidebar
  useEffect(() => {
    const handleResize = () => {
      // On mobile (< lg), close sidebar by default
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      } else {
        // On desktop, keep sidebar open
        setSidebarOpen(true);
      }
    };

    // Set initial state
    handleResize();
    
    // Listen for window resize
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className={`flex-1 flex flex-col transition-all duration-300 ${
          sidebarOpen ? 'lg:ml-[257px]' : 'lg:ml-0'
        }`}>
          <Header 
            onMenuClick={() => setSidebarOpen(!sidebarOpen)} 
            sidebarOpen={sidebarOpen}
            title={pageTitle}
          />
          <main className="flex-1 min-w-0">
            <div className="p-2 sm:py-4 sm:pr-4 sm:pl-4">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
