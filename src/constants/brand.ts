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

export const NAVIGATION = {
  main: [
    { name: "Connect", href: "/connect", icon: "Wifi" },
    { name: "Overview", href: "/overview", icon: "LayoutGrid" },
    { name: "Health", href: "/cluster-health", icon: "Activity" },
    { name: "Analysis", href: "/cluster-analysis", icon: "Target" },
    { name: "Nodes", href: "/nodes", icon: "Server" },
    { name: "Indices", href: "/indices", icon: "Database" },
    { name: "Monitoring", href: "/monitoring", icon: "ActivitySquare" },
    { name: "AI Query", href: "/ai-query", icon: "Sparkles" },
  ],
  secondary: [
    { name: "Shards", href: "/shards", icon: "Layers" },
    { name: "Index Advisor", href: "/index-advisor", icon: "Lightbulb" },
    { name: "Query Workbench", href: "/query-workbench", icon: "PanelLeftOpen" },
    { name: "Config & Policies", href: "/cluster-config", icon: "BookOpen" },
    { name: "Reindex Wizard", href: "/reindex-wizard", icon: "RefreshCw" },
    { name: "Bulk Operations", href: "/bulk-operations", icon: "Zap" },
  ],
  advanced: [
    { name: "Connections", href: "/connections", icon: "Globe" },
    { name: "Cluster Compare", href: "/cluster-compare", icon: "GitCompare" },
    { name: "Search Analytics", href: "/search-analytics", icon: "BarChart3" },
    { name: "Delete by Query", href: "/delete-by-query", icon: "Trash2" },
    { name: "Data Migration", href: "/data-migration", icon: "Shuffle" },
    { name: "Alerts", href: "/alerts", icon: "BellRing" },
    { name: "Scheduled Reports", href: "/scheduled-reports", icon: "CalendarClock" },
    { name: "Reports", href: "/reports", icon: "FileDown" },
    { name: "Audit Trail", href: "/audit-trail", icon: "ScrollText" },
    { name: "User Management", href: "/user-management", icon: "Users" },
    { name: "Auth Config", href: "/auth-config", icon: "Shield" },
  ],
} as const;
