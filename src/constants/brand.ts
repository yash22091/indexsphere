export const BRAND = {
  name: "Indexsphere",
  tagline: "Elasticsearch Web Admin Tool",
  description: "A modern, responsive web admin for Elasticsearch clusters built with React, Next.js, and TypeScript.",
  author: "Yash Patel",
  version: "1.0.0",
} as const;

export const COLORS = {
  primary: {
    50: "#f0f9ff",
    100: "#e0f2fe", 
    500: "#0ea5e9",
    600: "#0284c7",
    900: "#0c4a6e",
  },
  secondary: {
    50: "#f8fafc",
    100: "#f1f5f9",
    500: "#64748b", 
    600: "#475569",
    900: "#0f172a",
  },
  status: {
    green: "#10b981",
    yellow: "#f59e0b",
    red: "#ef4444",
    gray: "#6b7280",
  },
} as const;

// Navigation lives in ./navigation.ts (NAV_GROUPS).
