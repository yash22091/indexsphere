import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/contexts/theme-context";
import { AuthProvider } from "@/contexts/auth-context";
import { ConnectionProvider } from "@/contexts/connection-context";
import { LayoutWrapper } from "@/components/templates/layout-wrapper";
import SecurityGuard from "@/components/organisms/security-guard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Indexsphere - Elasticsearch Web Admin",
  description: "Modern Elasticsearch cluster management and administration tool by Yash Patel",
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/indexsphere-logo.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <ConnectionProvider>
              <SecurityGuard />
              <LayoutWrapper>
                {children}
              </LayoutWrapper>
            </ConnectionProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
