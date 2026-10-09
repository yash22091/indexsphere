import type { LucideIcon } from "lucide-react";
import {
  Activity, ArrowRightLeft, BarChart3, BellRing, BookOpen, CalendarClock, Database, FileDown, Gauge, GitCompare, History,
  Globe, Layers, LayoutDashboard, Lightbulb, PlugZap, RefreshCw, ScrollText, Server, Settings, Shield,
  ShieldAlert, ShieldCheck, Shuffle, Sparkles, Table2, Target, TerminalSquare, Trash2, Users, Zap, HeartPulse, LineChart,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Extra words for the ⌘K command palette. */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Single source of truth for the sidebar, breadcrumbs and the command palette. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "search",
    label: "Elasticsearch / OpenSearch",
    items: [
      { title: "Overview", href: "/overview", icon: LayoutDashboard },
      { title: "Cluster health", href: "/cluster-health", icon: HeartPulse, keywords: "jvm heap cpu disk" },
      { title: "Cluster analysis", href: "/cluster-analysis", icon: Target, keywords: "score best practices" },
      { title: "Live monitoring", href: "/monitoring", icon: LineChart, keywords: "metrics realtime sse" },
      { title: "Nodes", href: "/nodes", icon: Server },
      { title: "Indices", href: "/indices", icon: Database },
      { title: "Shards", href: "/shards", icon: Layers, keywords: "allocation unassigned" },
      { title: "Index advisor", href: "/index-advisor", icon: Lightbulb, keywords: "score grade recommendations" },
      { title: "Query workbench", href: "/query-workbench", icon: TerminalSquare, keywords: "dsl profile explain" },
      { title: "AI query", href: "/ai-query", icon: Sparkles, keywords: "natural language llm" },
      { title: "Search analytics", href: "/search-analytics", icon: BarChart3 },
      { title: "Config & policies", href: "/cluster-config", icon: BookOpen, keywords: "aliases templates ilm ism snapshots" },
    ],
  },
  {
    id: "data",
    label: "Data operations",
    items: [
      { title: "Reindex", href: "/reindex-wizard", icon: RefreshCw },
      { title: "Bulk operations", href: "/bulk-operations", icon: Zap, keywords: "close open forcemerge" },
      { title: "Delete by query", href: "/delete-by-query", icon: Trash2 },
      { title: "Data migration", href: "/data-migration", icon: Shuffle },
      { title: "Cluster compare", href: "/cluster-compare", icon: GitCompare, keywords: "diff" },
    ],
  },
  {
    id: "clickhouse",
    label: "ClickHouse",
    items: [
      { title: "Overview", href: "/clickhouse", icon: Gauge, keywords: "clickhouse" },
      { title: "Explorer", href: "/clickhouse/explorer", icon: Table2, keywords: "clickhouse tables databases" },
      { title: "Query activity", href: "/clickhouse/queries", icon: Activity, keywords: "clickhouse slow failed" },
      { title: "SQL workbench", href: "/clickhouse/sql", icon: TerminalSquare, keywords: "clickhouse sql" },
      { title: "Table advisor", href: "/clickhouse/advisor", icon: Lightbulb, keywords: "clickhouse best practices schema" },
      { title: "Migrate from Elasticsearch", href: "/clickhouse/migrate", icon: ArrowRightLeft, keywords: "clickhouse mapping ddl" },
    ],
  },
  {
    id: "security",
    label: "Security",
    items: [
      { title: "Security posture", href: "/security/posture", icon: ShieldCheck, keywords: "hardening audit tls users grants" },
      { title: "Vulnerabilities", href: "/vulnerabilities", icon: ShieldAlert, keywords: "cve nvd kev" },
      { title: "Configuration drift", href: "/security/drift", icon: History, keywords: "changes snapshots diff history" },
      { title: "Audit trail", href: "/audit-trail", icon: ScrollText },
    ],
  },
  {
    id: "automation",
    label: "Alerts & reports",
    items: [
      { title: "Alerts", href: "/alerts", icon: BellRing },
      { title: "Scheduled reports", href: "/scheduled-reports", icon: CalendarClock },
      { title: "Reports", href: "/reports", icon: FileDown, keywords: "pdf export" },
    ],
  },
  {
    id: "admin",
    label: "Administration",
    items: [
      { title: "Connections", href: "/connections", icon: Globe, keywords: "clusters saved" },
      { title: "Quick connect", href: "/connect", icon: PlugZap },
      { title: "Users", href: "/user-management", icon: Users, adminOnly: true },
      { title: "Authentication", href: "/auth-config", icon: Shield, adminOnly: true },
      { title: "Settings", href: "/settings", icon: Settings, keywords: "smtp email" },
    ],
  },
];

export function findNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  // Longest matching href wins (/clickhouse/sql over /clickhouse)
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!best || item.href.length > best.item.href.length) best = { group, item };
      }
    }
  }
  return best;
}

